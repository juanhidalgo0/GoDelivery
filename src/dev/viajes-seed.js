// SOLO DESARROLLO: un cliente pidiendo un viaje en moto (para el video de Viajes, reel/flows/go-viaje.js).
//   GO_PREVIEW_SEED=viajes-seed node node_modules/vite/bin/vite.js --config vite.preview.config.js --port 5180
// Abrir /#/viajes. Cliente con direcciones guardadas y un chofer en moto conectado.
// No lee ni escribe la base real.
import { mockDb, Timestamp } from 'firebase/firestore';

const CLIENT = { uid: 'cliente-demo', email: 'cliente@demo.test', displayName: 'Lucía Fernández' };
window.__mockAuthUser = { ...CLIENT, getIdToken: async () => 'demo', emailVerified: true, providerData: [] };
try {
  localStorage.setItem('gd-onboarding-done', 'true');
  localStorage.setItem('gd-whats-new-seen', '999');
  localStorage.setItem('info_seen_viajes_v4', 'true');
  sessionStorage.setItem('pwa_skipped', 'true');
} catch (e) {}

const ago = (min) => Timestamp.fromMillis(Date.now() - min * 60000);
const CASA = { lat: -35.0835, lng: -57.5230 };
const TRABAJO = { lat: -35.0738, lng: -57.5081 };
const ALL_SAVED = [
  { id: 'a1', name: 'Casa', address: 'Belgrano 355', notes: '', coords: CASA },
  { id: 'a2', name: 'Trabajo', address: 'Av. Mitre 1420', notes: '', coords: TRABAJO },
  // Serie "¿Cuánto te sale ir hasta...?" (reel/src/Precio.jsx): mismos puntos que reel/map-viajes.mjs
  { id: 'centro', name: 'Centro', address: 'Plaza San Martín', notes: '', coords: { lat: -35.0806743, lng: -57.5177564 } },
  { id: 'atalaya', name: 'Atalaya', address: 'Atalaya, Magdalena', notes: '', coords: { lat: -35.0250665, lng: -57.5299177 } },
  { id: 'rio', name: 'El río', address: 'Balneario Magdalena', notes: '', coords: { lat: -35.0312866, lng: -57.5062131 } },
  { id: 'penal', name: 'El penal', address: 'Unidad Penitenciaria', notes: '', coords: { lat: -35.1035, lng: -57.4725 } },
  { id: 'empalme', name: 'Empalme', address: 'Ex estación Empalme Magdalena', notes: '', coords: { lat: -35.0699366, lng: -57.53437 } },
];
// ?destino=atalaya: solo "Centro" y ese destino, para que la lista se vea limpia en el video
const DESTINO = new URLSearchParams(location.search).get('destino');
const SAVED = DESTINO ? ALL_SAVED.filter(a => a.id === 'centro' || a.id === DESTINO) : ALL_SAVED.slice(0, 2);
try { localStorage.setItem('gd-saved-addresses', JSON.stringify(SAVED)); localStorage.setItem('gd-address', 'Belgrano 355'); } catch (e) {}

mockDb.set(`users/${CLIENT.uid}`, {
  role: 'user', displayName: CLIENT.displayName, name: CLIENT.displayName, email: CLIENT.email,
  phone: '2221554433', phoneVerified: true, onboardingCompleted: true, clientTourDone: true, createdAt: ago(60 * 24 * 90),
  savedAddresses: SAVED, lastAddress: { address: 'Belgrano 355', notes: '', coords: CASA },
});
mockDb.set('users/chofer-demo', {
  role: 'chofer', tripStatus: 'approved', tripVehicleType: 'moto', vehicleType: 'moto', isOnline: true,
  displayName: 'Martín Gómez', name: 'Martín Gómez',
});
// Tarifa de Viajes publicada (settings/global de producción al 10-10-2026)
mockDb.set('settings/global', { deliveryMinPrice: 2000, tripBasePrice: 1500, tripPricePerKm: 650, tripMinPrice: 2300, rainMode: 'off' });
