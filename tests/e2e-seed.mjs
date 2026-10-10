// Datos para probar un pedido completo contra los emuladores (nada toca producción):
//   npx firebase-tools emulators:start --config firebase.e2e.json --project demo-godelivery
//   node tests/e2e-seed.mjs
// Después, la app con VITE_USE_EMULATORS=true en tres orígenes distintos (cliente, comercio y
// cadete no comparten sesión). Cuentas de prueba (sólo existen en el emulador):
//   cliente@e2e.test / e2e-cliente-123
//   comercio@e2e.test / e2e-comercio-123
//   cadete@e2e.test  / e2e-cadete-123
import { createRequire } from 'module';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const admin = require('firebase-admin');

process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
admin.initializeApp({ projectId: 'demo-godelivery' });
const db = admin.firestore();
const auth = admin.auth();

export const ACCOUNTS = {
  cliente: { email: 'cliente@e2e.test', password: 'e2e-cliente-123', name: 'Lucía Prueba' },
  comercio: { email: 'comercio@e2e.test', password: 'e2e-comercio-123', name: 'Carlos Pizzero' },
  cadete: { email: 'cadete@e2e.test', password: 'e2e-cadete-123', name: 'Martín Cadete' },
};
const CID = 'e2e-pizzeria';
const STORE = { lat: -35.0790, lng: -57.5140 };      // San Martín 1240
const HOME = { lat: -35.0835, lng: -57.5230 };       // Av. Mitre 820
const now = admin.firestore.Timestamp.now();

async function user(key, data) {
  const a = ACCOUNTS[key];
  let u;
  try { u = await auth.getUserByEmail(a.email); } catch (e) { u = await auth.createUser({ email: a.email, password: a.password, displayName: a.name }); }
  await db.doc(`users/${u.uid}`).set({
    email: a.email, displayName: a.name, name: a.name, createdAt: now, onboardingCompleted: true,
    // Que no tapen la prueba las guías de primera vez
    clientTourDone: true, commercePanelTourDone: true, driverTourDone: true, whatsNewSeen: true,
    ...data,
  }, { merge: true });
  return u.uid;
}

const clienteUid = await user('cliente', {
  role: 'user', phone: '2221000001', phoneVerified: true, points: 0, completedOrdersCount: 3,
  lastAddress: { address: 'Av. Mitre 820, Magdalena', notes: 'Portón negro', coords: HOME },
});
const comercioUid = await user('comercio', { role: 'comercio', isComercio: true, commerceStatus: 'approved', phone: '2221000002', phoneVerified: true });
const cadeteUid = await user('cadete', {
  role: 'delivery', isDelivery: true, deliveryStatus: 'approved', vehicleType: 'moto', vehiclePlate: 'A000AAA', vehicleModel: 'Honda Wave', driverAlias: 'martin.cadete.e2e',
  phone: '2221000003', phoneVerified: true, isOnline: false, deliveryDebt: 0, deliveryId: 'E2E-1',
});

const allDay = [{ open: '00:00', close: '23:59' }];
await db.doc(`comercios/${CID}`).set({
  name: 'Pizzería Prueba E2E', slug: 'pizzeria-prueba-e2e', ownerId: comercioUid, approvedByAdmin: true, isActive: true, isPaused: false,
  category: 'Pizzería', categories: ['Pizzería', 'Comida'], description: 'Comercio de prueba para el test de punta a punta.',
  address: 'San Martín 1240, Magdalena', coords: STORE, phone: '2221000002', logo: '/go-bag.png', banner: '/go-bag.png',
  schedules: allDay, daysOpen: [0, 1, 2, 3, 4, 5, 6],
  weeklySchedule: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map(d => [d, allDay])),
  createdAt: now,
});
await db.doc(`comercios/${CID}/categories/pizzas`).set({ name: 'Pizzas', order: 0, isActive: true });
await db.doc(`comercios/${CID}/products/muzza`).set({ name: 'Muzzarella grande', price: 11500, categoryId: 'pizzas', isAvailable: true, image: '', optionsGroups: [], stockMode: 'unlimited', order: 0, createdAt: now });
await db.doc(`comercios/${CID}/products/faina`).set({ name: 'Fainá', price: 2500, categoryId: 'pizzas', isAvailable: true, image: '', optionsGroups: [], stockMode: 'unlimited', order: 1, createdAt: now });

await db.doc('settings/global').set({
  deliveryMinPrice: 1500, deliveryExtraStopFee: 500, deliveryRainSurcharge: 300, rainMode: 'off',
  appUsageFeeRate: 0, dollarPerPoint: 1, commissionRate: 0.1, canonMinOrders: 99, debtLimitEnabled: false,
}, { merge: true });
await db.doc('settings/weather').set({ isRaining: false, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

console.log(JSON.stringify({ clienteUid, comercioUid, cadeteUid, comercioId: CID }, null, 2));
process.exit(0);
