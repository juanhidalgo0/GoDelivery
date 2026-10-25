// Simulación de "lo compra el repartidor" con la caja Ventra, contra los emuladores:
//   npx firebase-tools emulators:start --config firebase.e2e.json --project demo-godelivery
//   node tests/simulacion-paulos-seed.mjs
// Deja el comercio "Kiosco Paulos (simulación)" en modo compra el repartidor, un código para
// vincular la caja (PAULOS26) y estas cuentas (solo existen en el emulador):
//   cliente.sim@e2e.test / sim-cliente-123
//   cadete.sim@e2e.test  / sim-cadete-123
//   kioscopaulos7@gmail.com / sim-admin-123   (admin)
//   dueno.sim@e2e.test   / sim-dueno-123      (dueño del comercio)
import { createRequire } from 'module';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const admin = require('firebase-admin');

process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
if (!admin.apps.length) admin.initializeApp({ projectId: 'demo-godelivery' });
const db = admin.firestore();
const auth = admin.auth();
const { Timestamp } = require('firebase-admin/firestore');

export const SIM = {
  comercioId: 'sim-paulos',
  code: 'PAULOS26',
  cliente: { email: 'cliente.sim@e2e.test', password: 'sim-cliente-123', name: 'Lucía Simulación' },
  cadete: { email: 'cadete.sim@e2e.test', password: 'sim-cadete-123', name: 'Martín Repartidor' },
  admin: { email: 'kioscopaulos7@gmail.com', password: 'sim-admin-123', name: 'Admin GO' },
  dueno: { email: 'dueno.sim@e2e.test', password: 'sim-dueno-123', name: 'Dueño Paulos' },
};
const STORE = { lat: -35.0790, lng: -57.5140 };
const HOME = { lat: -35.0835, lng: -57.5230 };
const allDay = [{ open: '00:00', close: '23:59' }];

async function user(a, data) {
  let u;
  try { u = await auth.getUserByEmail(a.email); } catch { u = await auth.createUser({ email: a.email, password: a.password, displayName: a.name }); }
  await auth.updateUser(u.uid, { emailVerified: true });
  await db.doc(`users/${u.uid}`).set({
    email: a.email, displayName: a.name, name: a.name, createdAt: Timestamp.now(), onboardingCompleted: true,
    clientTourDone: true, commercePanelTourDone: true, driverTourDone: true, whatsNewSeen: true, ...data,
  }, { merge: true });
  return u.uid;
}

export async function seed() {
  await db.doc('settings/global').set({ deliveryMinPrice: 1500, appUsageFeeRate: 0.05, rainMode: 'off' }, { merge: true });
  const clienteUid = await user(SIM.cliente, { role: 'user', phone: '2221000201', phoneVerified: true, points: 0,
    address: 'Av. Mitre 820', deliveryAddress: 'Av. Mitre 820', deliveryCoords: HOME });
  const cadeteUid = await user(SIM.cadete, { role: 'delivery', isDelivery: true, deliveryStatus: 'approved', isOnline: true, deliveryDebt: 0,
    vehicleType: 'moto', phone: '2221000202', driverAlias: 'martin.go', lastLocation: STORE });
  await user(SIM.admin, { role: 'admin', isAdmin: true });
  const duenoUid = await user(SIM.dueno, { role: 'comercio', isComercio: true });
  await db.doc(`comercios/${SIM.comercioId}`).set({
    name: 'Kiosco Paulos (simulación)', ownerId: duenoUid, approvedByAdmin: true, isActive: true, isPaused: false,
    category: 'Kiosco', address: 'San Martín 1240', coords: STORE, phone: '2221000200',
    logo: '/go-bag.png?v=6', banner: '/go-bag.png?v=6',
    schedules: allDay, daysOpen: [0, 1, 2, 3, 4, 5, 6],
    weeklySchedule: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, allDay])),
    fulfillmentMode: 'shopper', createdAt: Timestamp.now(),
  }, { merge: true });
  await db.doc(`comercios/${SIM.comercioId}/private/team`).set({ ownerEmail: SIM.dueno.email, pendingOwnerEmail: '', members: [] });
  await db.doc(`ventra_links/${SIM.code}`).set({
    comercioId: SIM.comercioId, createdBy: 'sim', createdAt: Timestamp.now(), expiresAt: Timestamp.fromMillis(Date.now() + 48 * 3600e3),
  });
  return { clienteUid, cadeteUid, duenoUid };
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1].endsWith('simulacion-paulos-seed.mjs')) {
  const ids = await seed();
  console.log('Simulación lista:', ids);
  process.exit(0);
}
