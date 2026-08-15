// GoDelivery — Public Live Tracking Page for WhatsApp Clients
import { db } from '../firebase.js';
import { doc, onSnapshot } from 'firebase/firestore';

export function renderPublicWATracking(container, orderId) {
  if (!container) container = document.getElementById('app-content');
  if (!container || !orderId) return;

  container.innerHTML = `
    <div style="width:100%; height:100dvh; display:flex; flex-direction:column; background:#0f172a; font-family:system-ui, sans-serif; color:white; overflow:hidden;">
      <!-- Top Bar -->
      <div style="background:#1e293b; padding:16px 20px; display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid rgba(255,255,255,0.1); z-index:10;">
        <div style="display:flex; align-items:center; gap:10px;">
          <div style="width:36px; height:36px; border-radius:10px; background:#25D366; display:flex; align-items:center; justify-content:center; color:white; font-weight:900;">🛵</div>
          <div>
            <div style="font-weight:900; font-size:15px; color:white; line-height:1.1;">Seguimiento en Vivo</div>
            <div id="wa-order-status-badge" style="font-size:11px; color:#25D366; font-weight:700; margin-top:2px;">Buscando repartidor...</div>
          </div>
        </div>
        <div style="font-size:11px; background:rgba(255,255,255,0.1); padding:4px 10px; border-radius:12px; font-weight:700; color:#cbd5e1;">GoDelivery</div>
      </div>

      <!-- Map Container -->
      <div id="wa-public-map" style="flex:1; width:100%; position:relative; background:#020617;">
        <div id="wa-map-loader" style="position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; background:rgba(15, 23, 42, 0.85); z-index:5;">
          <div style="font-size:28px; margin-bottom:10px;">📍</div>
          <div style="font-size:14px; font-weight:700; color:#94a3b8;">Cargando mapa en tiempo real...</div>
        </div>
      </div>

      <!-- Footer Info -->
      <div id="wa-driver-info-card" style="background:#1e293b; padding:20px; border-top:1px solid rgba(255,255,255,0.1); display:flex; flex-direction:column; gap:12px; z-index:10;">
        <div style="display:flex; align-items:center; justify-content:space-between;">
          <div>
            <div style="font-size:11px; color:#94a3b8; font-weight:800; text-transform:uppercase;">Repartidor Asignado</div>
            <div id="wa-driver-name" style="font-size:16px; font-weight:900; color:white; margin-top:2px;">Por asignar...</div>
          </div>
        </div>

        <div style="background:#0f172a; padding:12px 14px; border-radius:12px; display:flex; align-items:center; justify-content:space-between;">
          <div style="font-size:12px; color:#cbd5e1;">📍 Destino: <strong id="wa-dest-addr">---</strong></div>
        </div>
      </div>
    </div>
  `;

  let map = null;
  let driverMarker = null;

  const loadLeaflet = () => {
    if (window.L) {
      initMap();
      return;
    }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);

    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.onload = () => initMap();
    document.head.appendChild(script);
  };

  const initMap = () => {
    const loader = document.getElementById('wa-map-loader');
    if (loader) loader.style.display = 'none';

    map = L.map('wa-public-map', { zoomControl: false }).setView([-35.0812, -57.5129], 15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19
    }).addTo(map);

    listenOrderUpdates();
  };

  const listenOrderUpdates = () => {
    onSnapshot(doc(db, 'orders', orderId), (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();

      const statusBadge = document.getElementById('wa-order-status-badge');
      const driverNameEl = document.getElementById('wa-driver-name');
      const destAddrEl = document.getElementById('wa-dest-addr');

      if (destAddrEl) destAddrEl.textContent = data.deliveryAddress || 'Domicilio';
      if (driverNameEl) driverNameEl.textContent = data.driverName || (data.driverId ? 'Repartidor Asignado' : 'Buscando repartidor...');

      if (statusBadge) {
        if (data.status === 'completed') {
          statusBadge.textContent = '✅ Pedido Entregado';
          statusBadge.style.color = '#10b981';
        } else if (data.status === 'delivering' || data.status === 'accepted') {
          statusBadge.textContent = '🚴 En Camino';
          statusBadge.style.color = '#38bdf8';
        } else if (data.status === 'at_door') {
          statusBadge.textContent = '🔔 Repartidor en la Puerta';
          statusBadge.style.color = '#f59e0b';
        } else {
          statusBadge.textContent = '⏳ Buscando Repartidor...';
          statusBadge.style.color = '#25D366';
        }
      }

      if (data.driverLocation && data.driverLocation.lat && data.driverLocation.lng && map) {
        const dLat = data.driverLocation.lat;
        const dLng = data.driverLocation.lng;

        if (!driverMarker) {
          const bikeIcon = L.divIcon({
            html: '<div style="background:#25D366; width:36px; height:36px; border-radius:50%; display:flex; align-items:center; justify-content:center; color:white; font-size:18px; box-shadow:0 4px 12px rgba(0,0,0,0.4); border:2px solid white;">🚴</div>',
            className: '',
            iconSize: [36, 36],
            iconAnchor: [18, 18]
          });
          driverMarker = L.marker([dLat, dLng], { icon: bikeIcon }).addTo(map);
        } else {
          driverMarker.setLatLng([dLat, dLng]);
        }
        map.panTo([dLat, dLng]);
      }
    });
  };

  loadLeaflet();
}
