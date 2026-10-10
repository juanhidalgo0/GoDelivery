// SOLO DESARROLLO: pantalla de Mandados con un cliente que ya pidió mandados.
//   GO_PREVIEW_SEED=mandados-seed node node_modules/vite/bin/vite.js --config vite.preview.config.js --port 5177
// Abrir /?test=true#/mandados (?nuevo=1: cliente sin mandados anteriores; ?sinRepartidores=1: nadie
// conectado). No toca la base real.
import { mockDb, Timestamp } from 'firebase/firestore';

const params = new URLSearchParams(location.search);
const CLIENT = { uid: 'cliente-demo', email: 'cliente@demo.test', displayName: 'Juan Hidalgo' };
window.__mockAuthUser = { ...CLIENT, getIdToken: async () => 'demo', emailVerified: true, providerData: [] };
try {
  localStorage.setItem('gd-onboarding-done', 'true');
  localStorage.setItem('gd-whats-new-seen', '999');
  localStorage.removeItem('go_mandado_places_v1');
  localStorage.removeItem(`go_mandados_recent_${CLIENT.uid}`);
  // Los pedidos de prueba ya están entregados: sin el cartel de "¡Pedido entregado!" encima
  [0, 1, 2, 3].forEach(i => localStorage.setItem(`gd_dismissed_points_modal_mandado-demo-${i}`, 'true'));
} catch (e) { /* sin almacenamiento */ }

const ago = (min) => Timestamp.fromMillis(Date.now() - min * 60000);
const HOME = { lat: -35.0835, lng: -57.5230 };

mockDb.set(`users/${CLIENT.uid}`, {
  role: 'user', displayName: CLIENT.displayName, name: CLIENT.displayName, email: CLIENT.email, phone: '2221554433',
  onboardingCompleted: true, clientTourDone: true, createdAt: ago(60 * 24 * 90),
  lastAddress: { address: 'Av. Mitre 820, Magdalena', notes: 'Timbre B', coords: HOME },
});
mockDb.set('settings/global', { deliveryMinPrice: 1500, favorPurchaseFee: 800 });
// ?sinRepartidores=1: nadie conectado
mockDb.set('settings/driverAvailability', { onlineCount: params.get('sinRepartidores') === '1' ? 0 : 3, updatedAt: Timestamp.now() });

// Lugares que aprendieron los repartidores (visitas = compras hechas ahí)
[
  ['farmacia-del-pueblo', 'Farmacia del Pueblo', -35.0800, -57.5185, 'farmacia', 14],
  ['verduleria-el-trebol', 'Verdulería El Trébol', -35.0772, -57.5150, 'verduleria', 9],
  ['maxikiosco-paulos', 'Maxikiosco Paulos', -35.0815, -57.5147, 'kiosco', 7],
  ['carniceria-los-hermanos', 'Carnicería Los Hermanos', -35.0790, -57.5170, 'carniceria', 4],
  ['libreria-el-estudiante', 'Librería El Estudiante', -35.0822, -57.5120, 'libreria', 2],
].forEach(([id, name, lat, lng, category, visits]) => mockDb.set(`mandadoPlaces/${id}`, { name, lat, lng, category, visits, samples: [{ lat, lng }, { lat, lng }] }));

const stop = (n, store, items) => `🏪 **${n}. Comercio:** ${store}\n📦 **Pedido:** ${items}`;
if (params.get('nuevo') !== '1') {
  [
    [60 * 5, [stop(1, 'Farmacia del Pueblo', 'Ibuprofeno 400 x2, alcohol en gel')]],
    [60 * 30, [stop(1, 'Verdulería El Trébol', '1 kg de papas, 1/2 kg de tomates'), stop(2, 'Carnicería Los Hermanos', '1 kg de carne picada')]],
    [60 * 50, [stop(1, 'Farmacia del Pueblo', 'Ibuprofeno 400 x2, alcohol en gel')]], // repetido: no aparece dos veces
    [60 * 72, [stop(1, 'Maxikiosco Paulos', '2 alfajores, 1 Coca-Cola 2,25 L')]],
  ].forEach(([min, stops], i) => mockDb.set(`orders/mandado-demo-${i}`, {
    orderId: 7000 + i, userId: CLIENT.uid, isFavor: true, favorType: 'compra', status: 'completed', stopsCount: stops.length,
    details: stops.join('\n\n'), pickupAddress: 'Comercio: varios', deliveryAddress: 'Av. Mitre 820', deliveryCoords: HOME,
    total: 5200, createdAt: ago(min),
  }));
}

// ?libre=1: navegar por el resto de la app con el mismo cliente (perfil, pedidos...)
if (!location.hash.startsWith('#/mandados') && params.get('libre') !== '1') location.hash = '#/mandados';

// Banner de mandados con envío bonificado (?banner=1): el tope del día lo cuenta el servidor en
// stats.discountedByDay (la app no puede leer los pedidos)
if (params.get('banner') === '1') {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
  mockDb.set('banners_mandados/promo-demo', {
    status: 'active', merchantName: 'Farmacia del Pueblo', title: 'Farmacia del Pueblo', subtitle: 'Pedí tus remedios',
    hasDiscount: true, discountAmount: 500, discountLimitPerDay: 5, imageUrl: '/go-bag.png?v=7',
    stats: { impressions: 10, clicks: 2, discountedByDay: { [day]: params.get('agotado') === '1' ? 5 : 1 } },
  });
}
