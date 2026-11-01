// SOLO DESARROLLO: datos de prueba para ver el panel del comercio con la app completa.
//   GO_PREVIEW_SEED=comercio-seed node node_modules/vite/bin/vite.js --config vite.preview.config.js --port 5176
// Abrir /#/mi-comercio (entra como el dueño de "Pizzería Don Juan"). ?pin=1 le pone PIN 1234.
// No lee ni escribe la base real.
import { mockDb, Timestamp } from 'firebase/firestore';

const params = new URLSearchParams(location.search);
// La alarma de pedidos pendientes suena en bucle: en la vista previa queda muda salvo ?alarma=1
if (params.get('alarma') !== '1') {
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    if (String(this.src || '').includes('pedido-nuevo')) return Promise.resolve();
    return play.call(this);
  };
}
const OWNER = { uid: 'dueno-demo', email: 'dueno@demo.test', displayName: 'Carlos Pérez' };
const CID = 'pizza-demo';
try { localStorage.setItem('gd-onboarding-done', 'true'); localStorage.setItem('gd-whats-new-seen', '999'); localStorage.setItem('gd-onboarding-reminded-at', String(Date.now())); } catch (e) {}
window.__mockAuthUser = { ...OWNER, getIdToken: async () => 'demo', emailVerified: true, providerData: [] };

const ago = (min) => Timestamp.fromMillis(Date.now() - min * 60000);
const inMin = (min) => Timestamp.fromMillis(Date.now() + min * 60000);
const STORE = { lat: -35.0790, lng: -57.5140 };

mockDb.set(`users/${OWNER.uid}`, { role: 'comercio', isComercio: true, commerceStatus: 'approved', displayName: OWNER.displayName, name: OWNER.displayName, email: OWNER.email, phone: '2221456789', onboardingCompleted: true, createdAt: ago(60 * 24 * 200) });
mockDb.set('settings/global', { deliveryMinPrice: 1500, commissionRate: 0.1 });
mockDb.set(`comercios/${CID}`, {
  name: 'Pizzería Don Juan', slug: 'pizzeria-don-juan', ownerId: OWNER.uid, isActive: true, approvedByAdmin: true,
  category: 'Pizzería', categories: ['Pizzería', 'Comida'], description: 'Pizzas a la piedra y empanadas caseras.',
  address: 'San Martín 1240, Magdalena', coords: STORE, phone: '2221456789', logo: '/go-bag.png?v=6', banner: '',
  schedules: [{ open: '19:00', close: '23:30' }], daysOpen: [0, 2, 3, 4, 5, 6],
  ratingAverage: 4.7, ratingCount: 128, averagePrepTime: 18, commissionRate: 0.1,
});
if (params.get('pin') === '1') mockDb.set(`comercios/${CID}/private/access`, { pin: '1234' });

const cats = [['c-pizzas', 'Pizzas', 0], ['c-empanadas', 'Empanadas', 1], ['c-bebidas', 'Bebidas', 2], ['c-postres', 'Postres', 3]];
cats.forEach(([id, name, order]) => mockDb.set(`comercios/${CID}/categories/${id}`, { name, order, isActive: true }));
const prods = [
  ['p1', 'Muzzarella grande', 11500, 'c-pizzas', true], ['p2', 'Napolitana', 13000, 'c-pizzas', true], ['p3', 'Fugazzeta', 13200, 'c-pizzas', false],
  ['p4', 'Especial de jamón y morrones', 14500, 'c-pizzas', true], ['p5', 'Fainá', 2500, 'c-pizzas', true],
  ['p6', 'Empanada de carne', 3000, 'c-empanadas', true], ['p7', 'Empanada de jamón y queso', 3000, 'c-empanadas', true], ['p8', 'Empanada de humita', 3000, 'c-empanadas', false],
  ['p9', 'Coca-Cola 1,5 L', 3400, 'c-bebidas', true], ['p10', 'Agua sin gas 500 ml', 1500, 'c-bebidas', true], ['p11', 'Flan casero', 3800, 'c-postres', true],
];
prods.forEach(([id, name, price, categoryId, isAvailable], i) => mockDb.set(`comercios/${CID}/products/${id}`, {
  name, price, categoryId, isAvailable, image: '', description: '', optionsGroups: [], stockMode: 'unlimited', order: i, createdAt: ago(60 * 24 * 30),
}));
// Venta por peso (src/utils/weight.js): un corte por kilo y un pedido aceptado que falta pesar
mockDb.set(`comercios/${CID}/products/p12`, {
  name: 'Vacío', price: 12000, categoryId: 'c-empanadas', isAvailable: true, image: '', description: 'Por kilo',
  optionsGroups: [], stockMode: 'unlimited', soldByWeight: true, weightStep: 250, order: 12, createdAt: ago(60 * 24 * 30),
});

const base = { comercioId: CID, comercioName: 'Pizzería Don Juan', comercioCoords: STORE, comercioAddress: 'San Martín 1240', paymentMethod: 'efectivo', paymentStatus: 'pending', deliveryType: 'delivery', deliveryCost: 1800, commissionStatus: 'pending' };
const order = (id, n, extra) => {
  const subtotal = extra.items.reduce((s, it) => s + it.price * it.qty, 0);
  mockDb.set(`orders/${id}`, { ...base, orderId: n, subtotal, total: subtotal + (extra.deliveryType === 'takeaway' ? 0 : 1800), commissionAmount: Math.round(subtotal * 0.1), ...extra });
};
order('o-1042', 1042, { status: 'pending', userName: 'Lucía Martínez', userId: 'u1', createdAt: ago(2), deliveryAddress: 'Av. Mitre 820', items: [{ name: 'Muzzarella grande', qty: 2, price: 11500 }, { name: 'Fainá', qty: 1, price: 2500 }] });
order('o-1043', 1043, { status: 'pending', userName: 'Marcos Ruiz', userId: 'u2', createdAt: ago(1), deliveryType: 'takeaway', items: [{ name: 'Napolitana', qty: 1, price: 13000 }, { name: 'Coca-Cola 1,5 L', qty: 2, price: 3400 }], notes: 'Sin aceitunas por favor' });
order('o-1039', 1039, { status: 'confirmed', userName: 'Ana Pereyra', userId: 'u3', createdAt: ago(14), confirmedAt: ago(12), preparationTimeMinutes: 20, estimatedReadyAt: inMin(8), deliveryAddress: 'Brenan 450', items: [{ name: 'Empanada de carne', qty: 6, price: 3000 }], paymentMethod: 'transferencia' });
order('o-1040', 1040, { status: 'confirmed', userName: 'Carla Benítez', userId: 'u10', createdAt: ago(10), confirmedAt: ago(9), preparationTimeMinutes: 15, estimatedReadyAt: inMin(6), deliveryAddress: 'Sarmiento 310', appUsageFee: 900, appUsageFeeRate: 0.05, hasWeighedItems: true, weighPending: true, items: [{ name: 'Vacío', qty: 6, price: 3000, soldByWeight: true, weightStep: 250, grams: 1500, pricePerKg: 12000 }, { name: 'Empanada de carne', qty: 2, price: 3000 }] });
order('o-1036', 1036, { status: 'ready', userName: 'José López', userId: 'u4', createdAt: ago(30), confirmedAt: ago(28), readyAt: ago(4), deliveryAddress: 'Rivadavia 55', items: [{ name: 'Fugazzeta', qty: 1, price: 13200 }] });
order('o-1030', 1030, { status: 'completed', userName: 'María Gómez', userId: 'u5', createdAt: ago(90), confirmedAt: ago(88), readyAt: ago(70), completedAt: ago(55), deliveryAddress: 'Moreno 1020', items: [{ name: 'Especial de jamón y morrones', qty: 1, price: 14500 }, { name: 'Flan casero', qty: 2, price: 3800 }] });
order('o-1028', 1028, { status: 'completed', userName: 'Pablo Ríos', userId: 'u6', createdAt: ago(60 * 26), confirmedAt: ago(60 * 26 - 2), readyAt: ago(60 * 26 - 20), completedAt: ago(60 * 26 - 35), deliveryAddress: 'Belgrano 355', items: [{ name: 'Muzzarella grande', qty: 1, price: 11500 }], commissionStatus: 'paid' });
order('o-1025', 1025, { status: 'cancelled', userName: 'Laura Paz', userId: 'u7', createdAt: ago(60 * 30), cancelledAt: ago(60 * 30 - 3), cancelledBy: 'comercio', cancelReason: 'Me falta un producto', items: [{ name: 'Fugazzeta', qty: 2, price: 13200 }] });
for (let d = 2; d <= 8; d++) {
  order(`o-h${d}`, 1000 + d, { status: 'completed', userName: 'Cliente', userId: 'u9', createdAt: ago(60 * 24 * d), completedAt: ago(60 * 24 * d - 40), confirmedAt: ago(60 * 24 * d - 2), readyAt: ago(60 * 24 * d - 20), items: [{ name: 'Muzzarella grande', qty: 1 + (d % 3), price: 11500 }, { name: 'Empanada de carne', qty: d, price: 3000 }], commissionStatus: d > 5 ? 'paid' : 'pending' });
}

mockDb.set('offers/of-1', { comercioId: CID, comercioName: 'Pizzería Don Juan', title: '2x1 en empanadas', type: '2x1', productIds: ['p6', 'p7'], active: true, createdAt: ago(60 * 24 * 3) });
mockDb.set('coupons/PIZZA10', { code: 'PIZZA10', ownerId: CID, type: 'percentage', value: 10, usageLimit: 50, usedCount: 6, active: true, createdAt: ago(60 * 24 * 5) });

// ?como=admin: entra como administrador para probar Comercios (arreglos, dueños) y Repartidores (ajustes).
if (params.get('como') === 'admin') {
  window.__mockAuthUser = { uid: 'admin-demo', email: 'admin@demo.test', displayName: 'Admin', getIdToken: async () => 'demo', emailVerified: true, providerData: [] };
  mockDb.set('users/admin-demo', { role: 'admin', isAdmin: true, displayName: 'Admin', email: 'admin@demo.test', onboardingCompleted: true });
  // Un comercio aprobado sin dueño y quien pidió el alta con ese nombre
  mockDb.set('comercios/bestia-1', { name: 'La Bestia Burgers', category: 'Hamburguesas', isActive: true, approvedByAdmin: true, logo: '', address: 'Mitre 900' });
  mockDb.set('users/u-bestia', { role: 'user', displayName: 'Nico Bestia', email: 'nico@demo.test', commerceStatus: 'pending', commerceApplication: { name: 'La bestia', phone: '2221000000', status: 'pending' } });
  // Un dueño que quedó sin rol por la aprobación que fallaba
  mockDb.set('comercios/kiosco-sin-rol', { name: 'Kiosco Sol', ownerId: 'u-sol', category: 'Kiosco', isActive: true, approvedByAdmin: true });
  mockDb.set('users/u-sol', { role: 'user', displayName: 'Sol', email: 'sol@demo.test' });
  mockDb.set('coupons/BIENVENIDA', { active: true, type: 'fixed', value: 3000, ownerId: 'admin' });
  // El comercio de los admin: "Mi comercio" tiene que llevar acá aunque antes se haya entrado a otro panel
  mockDb.set('comercios/gomarket-demo', { name: 'Go! Market', ownerId: 'admin-demo', category: 'GoMarket', isActive: true, approvedByAdmin: true, logo: '/go-bag.png?v=6', schedules: [{ open: '00:00', close: '23:59' }] });
  mockDb.set('users/cadete-demo', { role: 'delivery', isDelivery: true, deliveryStatus: 'approved', displayName: 'Martín Gómez', deliveryDebt: 7350, ledgerSeq: 0 });
}

// ?como=cadete: entra como repartidor aprobado (para ver su panel y su guía).
if (params.get('como') === 'cadete') {
  window.__mockAuthUser = { uid: 'cadete-demo', email: 'cadete@demo.test', displayName: 'Martín Gómez', getIdToken: async () => 'demo', emailVerified: true, providerData: [] };
  mockDb.set('users/cadete-demo', { role: 'delivery', isDelivery: true, deliveryStatus: 'approved', displayName: 'Martín Gómez', name: 'Martín Gómez', email: 'cadete@demo.test', phone: '2221667788', vehicleType: 'moto', isOnline: false, deliveryDebt: 7350, onboardingCompleted: true });
}

// ?whatsapp=1: un cliente pidió por WhatsApp y espera que el comercio le diga el precio
if (params.get('whatsapp') === '1') {
  mockDb.set('wa_quotes/q-demo-1', {
    status: 'waiting', comercioId: CID, comercioName: 'Pizzería Don Juan', waPhone: '5492215551111',
    customerName: 'Laura', customerPhone: '2215551111', createdAtMs: Date.now() - 2 * 60000,
    requestText: '2 muzzarellas grandes, una con aceitunas y otra sin.\n6 empanadas de carne cortada a cuchillo.',
    media: [], deliveryAddress: 'Calle 12 450, timbre 2B', paymentMethod: 'efectivo',
  });
}

// ?dos=1: el dueño tiene un segundo comercio (para probar el selector y el aviso de pedidos)
if (params.get('dos') === '1') {
  mockDb.set('comercios/heladeria-demo', { name: 'Heladería Don Juan', ownerId: OWNER.uid, isActive: true, approvedByAdmin: true, category: 'Heladería', address: 'Mitre 500', logo: '/go-bag.png?v=6', schedules: [{ open: '00:00', close: '23:59' }] });
  mockDb.set('orders/o-hel-1', { comercioId: 'heladeria-demo', comercioName: 'Heladería Don Juan', orderId: 2001, status: 'pending', userName: 'Pedro', userId: 'u8', createdAt: Timestamp.now(), items: [{ name: '1 kg helado', qty: 1, price: 9000 }], subtotal: 9000, total: 9000, deliveryType: 'delivery' });
}
