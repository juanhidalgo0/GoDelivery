// SOLO DESARROLLO: anuncio "Kiosco Paulos llegó a GO!" en el inicio de un cliente.
//   GO_PREVIEW_SEED=lanzamiento-seed node node_modules/vite/bin/vite.js --config vite.preview.config.js --port 5184
// Abrir /#/ (?dia=N: simula que ya se mostró N días; ?reset=1 lo vuelve a cero). No toca la base real.
import { mockDb, Timestamp } from 'firebase/firestore';

const params = new URLSearchParams(location.search);
const CLIENT = { uid: 'cliente-demo', email: 'cliente@demo.test', displayName: 'Juan Hidalgo' };
window.__mockAuthUser = { ...CLIENT, getIdToken: async () => 'demo', emailVerified: true, providerData: [] };
try {
  localStorage.setItem('gd-onboarding-done', 'true');
  localStorage.setItem('gd-whats-new-seen', '999');
  localStorage.setItem('welcome_beta_v1', 'true');
  localStorage.setItem('gd-client-tour-done', '1');
  localStorage.setItem('gd_app_only_promo_last', String(Date.now()));
  if (params.get('reset') === '1') localStorage.removeItem('gd_launch_ad_paulos');
  if (params.has('dia')) localStorage.setItem('gd_launch_ad_paulos', JSON.stringify({ count: Number(params.get('dia')), last: '2000-01-01' }));
} catch (e) { /* sin almacenamiento */ }

mockDb.set(`users/${CLIENT.uid}`, {
  role: 'user', displayName: CLIENT.displayName, name: CLIENT.displayName, email: CLIENT.email, phone: '2221554433',
  onboardingCompleted: true, clientTourDone: true, seenRedesign2026b: true, createdAt: Timestamp.fromMillis(Date.now() - 90 * 864e5),
  lastAddress: { address: 'Av. Mitre 820, Magdalena', notes: '', coords: { lat: -35.0835, lng: -57.5230 } },
});
mockDb.set('settings/global', { deliveryMinPrice: 1500 });
mockDb.set('comercios/gV5p2aGcgrRBM1n5wsGg', {
  name: 'Kiosco Paulos', isActive: true, isOpen: true, rubro: 'kiosco', logo: '/paulos-logo-real.jpg?v=9',
  address: 'Magdalena', coords: { lat: -35.0815, lng: -57.5147 }, fulfillmentMode: 'shopper',
});
