// SOLO DESARROLLO: datos de prueba para ver el seguimiento en vivo con la app completa
// (servidor vite.preview.config.js). Carga un cliente, un repartidor y un pedido, y simula
// al repartidor moviéndose por las calles de Magdalena (manda su posición cada 3,5 s, como la app).
//
//   /#/pedido/demo?caso=comercio-en-camino   (casos: ver CASES abajo)
import { mockDb, Timestamp } from 'firebase/firestore';

const params = new URLSearchParams(location.search || location.hash.split('?')[1] || '');
const caso = params.get('caso') || 'comercio-en-camino';
const ORDER_ID = 'demo';
const CLIENT = { uid: 'cliente-demo', email: 'cliente@demo.test', displayName: 'Juan Hidalgo' };
// ?como=repartidor abre la misma pantalla con la cuenta del repartidor (su vista no cambió)
const AS_DRIVER = params.get('como') === 'repartidor';
window.__mockAuthUser = AS_DRIVER
  ? { uid: 'repartidor-demo', email: 'repartidor@demo.test', displayName: 'Martín Gómez', getIdToken: async () => 'demo', emailVerified: true, providerData: [] }
  : { ...CLIENT, getIdToken: async () => 'demo', emailVerified: true, providerData: [] };

const ago = (min) => Timestamp.fromMillis(Date.now() - min * 60000);
const HOME = { lat: -35.0835, lng: -57.5230 };           // Av. Mitre 820
const STORE = { lat: -35.0790, lng: -57.5140 };          // Pizzería
const DRIVER_START = { lat: -35.0760, lng: -57.5100 };

mockDb.set(`users/${CLIENT.uid}`, { role: 'user', displayName: CLIENT.displayName, name: CLIENT.displayName, email: CLIENT.email, phone: '2221554433', points: 120, onboardingCompleted: true, createdAt: ago(60 * 24 * 90) });
mockDb.set('users/repartidor-demo', { role: 'delivery', isDelivery: true, displayName: 'Martín Gómez', name: 'Martín Gómez', phone: '2221667788', photoURL: '', vehicleType: 'moto', vehiclePlate: 'A123BCD', rating: 4.9, ratingsCount: 212, isOnline: true });
mockDb.set('comercios/pizza-demo', { name: 'Pizzería Los Sabores', address: 'San Martín 1240', coords: STORE, logo: '/go-bag.png?v=6', ownerId: 'x', isActive: true, category: 'Pizzería', phone: '2221456789' });
mockDb.set('settings/global', { deliveryMinPrice: 1500 });

const driver = { driverId: 'repartidor-demo', driverName: 'Martín Gómez', driverPhone: '2221667788', driverPhoto: '', driverVehicle: 'moto', acceptedAt: ago(9) };
const baseCommerce = {
  orderId: 8492, comercioId: 'pizza-demo', comercioName: 'Pizzería Los Sabores', comercioCoords: STORE, comercioAddress: 'San Martín 1240',
  userId: CLIENT.uid, userName: CLIENT.displayName, userPhone: '2221554433',
  deliveryAddress: 'Av. Mitre 820', addressNotes: 'Timbre B', deliveryCoords: HOME, verificationCode: '4821',
  items: [{ name: 'Pizza especial de jamón y morrones', price: 9500, qty: 1, quantity: 1 }, { name: 'Empanadas de carne', price: 1250, qty: 4, quantity: 4 }],
  subtotal: 14500, deliveryCost: 1800, appUsageFee: 180, total: 16480, totalAmount: 16480, paymentMethod: 'efectivo', paymentStatus: 'pending',
  createdAt: ago(24), source: 'app',
};
const CASES = {
  'buscando': { ...baseCommerce, status: 'pending' },
  'comercio-preparando': { ...baseCommerce, status: 'confirmed', confirmedAt: ago(18) },
  'comercio-listo': { ...baseCommerce, status: 'ready', ...driver },
  'comercio-en-camino': { ...baseCommerce, status: 'delivering', ...driver, pickedUpAt: ago(4) },
  'mandado-en-camino': {
    orderId: 2210, isFavor: true, favorType: 'compra', userId: CLIENT.uid, userName: CLIENT.displayName, status: 'delivering', ...driver, pickedUpAt: ago(3),
    pickupAddress: 'Comercio: Farmacia del Pueblo', pickupCoords: { lat: -35.0811, lng: -57.5146 }, deliveryAddress: 'Av. Mitre 820', deliveryCoords: HOME,
    details: '🏪 **1. Comercio:** Farmacia del Pueblo\n📦 **Pedido:** Ibuprofeno 400 x2, alcohol en gel', verificationCode: '6748',
    deliveryCost: 2300, purchaseFee: 800, purchaseCost: 5400, appUsageFee: 30, total: 8530, paymentMethod: 'transferencia', createdAt: ago(30),
  },
  'viaje': {
    orderId: 3301, isTrip: true, tripType: 'moto', userId: CLIENT.uid, userName: CLIENT.displayName, status: 'accepted', ...driver,
    originAddress: 'Belgrano 355', pickupCoords: HOME, destinationAddress: 'Terminal de ómnibus', deliveryAddress: 'Terminal de ómnibus', deliveryCoords: { lat: -35.0900, lng: -57.5250 },
    total: 3200, paymentMethod: 'efectivo', createdAt: ago(6),
  },
  'entregado': { ...baseCommerce, status: 'completed', ...driver, pickedUpAt: ago(15), deliveredAt: ago(2), completedAt: ago(2) },
  'cancelado': { ...baseCommerce, status: 'cancelled', cancelledAt: ago(5), cancelReason: 'El comercio no tenía stock' },
};
const order = CASES[caso] || CASES['comercio-en-camino'];
mockDb.set(`orders/${ORDER_ID}`, order);
window.__trackingCases = Object.keys(CASES);

if (!location.hash.startsWith('#/pedido/')) location.hash = `#/pedido/${ORDER_ID}`;

// ── Repartidor en movimiento (como la app: cada 3,5 s, con algo de ruido de GPS) ──
const moving = order.driverId && !['completed', 'cancelled'].includes(order.status);
if (moving) {
  const target = order.status === 'delivering' ? (order.deliveryCoords) : (order.isTrip ? order.pickupCoords : STORE);
  const start = order.status === 'delivering' && !order.isTrip ? STORE : DRIVER_START;
  mockDb.set(`orders/${ORDER_ID}/live/driver`, { ...start, heading: 0, speed: 0, updatedAt: Timestamp.now() });
  fetch(`https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${target.lng},${target.lat}?overview=full&geometries=geojson`)
    .then(r => r.json())
    .then(data => {
      const coords = data.routes?.[0]?.geometry?.coordinates || [[start.lng, start.lat], [target.lng, target.lat]];
      const pts = coords.map(([lng, lat]) => ({ lat, lng }));
      const m = (a, b) => Math.hypot((a.lat - b.lat) * 111000, (a.lng - b.lng) * 111000 * Math.cos(a.lat * Math.PI / 180));
      // ~25 km/h: 24 m cada 3,5 s
      let seg = 0, off = 0;
      const step = 24;
      const tick = () => {
        let left = step;
        while (seg < pts.length - 1 && left > 0) {
          const L = m(pts[seg], pts[seg + 1]) - off;
          if (left < L) { off += left; left = 0; } else { left -= L; seg += 1; off = 0; }
        }
        const a = pts[seg], b = pts[Math.min(seg + 1, pts.length - 1)];
        const L = m(a, b) || 1;
        const t = Math.min(1, off / L);
        const noise = () => (Math.random() - 0.5) * 0.00004; // ±2 m
        const p = { lat: a.lat + (b.lat - a.lat) * t + noise(), lng: a.lng + (b.lng - a.lng) * t + noise() };
        mockDb.set(`orders/${ORDER_ID}/live/driver`, { ...p, heading: 0, speed: 7, updatedAt: Timestamp.now() });
        if (seg < pts.length - 1) setTimeout(tick, 3500);
      };
      setTimeout(tick, 2500);
    })
    .catch(e => console.warn('[tracking-seed] sin ruta:', e));
}
