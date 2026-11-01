import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, deleteField, collection, collectionGroup, query, where, getDocs, addDoc, writeBatch, runTransaction,
} from 'firebase/firestore';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Suite de seguridad de firestore.rules.
//
//   npm i -D @firebase/rules-unit-testing
//   npx firebase emulators:exec --only firestore "node tests/firestore-rules.test.mjs"
//
// Cada vez que se tocan las reglas, esto tiene que dar 0 fallos antes de deployar.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = 'godelivery-rules-test';
const RULES = fs.readFileSync(path.join(HERE, '..', 'firestore.rules'), 'utf8');

const env = await initializeTestEnvironment({
  projectId: PROJECT,
  firestore: {
    rules: RULES,
    host: '127.0.0.1',
    port: Number(process.env.FIRESTORE_EMULATOR_PORT || 8080),
  },
});

// ---------------------------------------------------------------- seed data
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, 'users/cliente1'), { role: 'user', displayName: 'Vecino', phone: '221', points: 100 });
  await setDoc(doc(db, 'users/cliente2'), { role: 'user', displayName: 'Otro Vecino', phone: '221999', points: 0 });
  await setDoc(doc(db, 'users/cadete1'), { role: 'delivery', deliveryStatus: 'approved', displayName: 'Cadete', ratings: [] });
  await setDoc(doc(db, 'users/duenoPizza'), { role: 'comercio', isComercio: true, displayName: 'Pizzeria' });
  await setDoc(doc(db, 'users/duenoKiosco'), { role: 'comercio', isComercio: true, displayName: 'Kiosco' });
  await setDoc(doc(db, 'users/jefe'), { role: 'admin', isAdmin: true, displayName: 'Admin' });

  await setDoc(doc(db, 'comercios/pizza'), { name: 'La Pizzeria', ownerId: 'duenoPizza', isActive: true });
  await setDoc(doc(db, 'comercios/kiosco'), { name: 'El Kiosco', ownerId: 'duenoKiosco', isActive: true });
  await setDoc(doc(db, 'comercios/pizza/products/p1'), { name: 'Muzzarella', price: 12000 });

  await setDoc(doc(db, 'orders/o1'), { userId: 'cliente1', comercioId: 'pizza', driverId: 'cadete1', status: 'pending', total: 15000 });
  await setDoc(doc(db, 'orders/o2'), { userId: 'cliente2', comercioId: 'kiosco', status: 'ready', total: 5000 });
  await setDoc(doc(db, 'orders/o3'), { userId: 'cliente1', comercioId: 'pizza', status: 'ready', driverId: 'cadete1', total: 9000 });

  await setDoc(doc(db, 'settings/global'), { deliveryCost: 1500 });
  await setDoc(doc(db, 'company_expenses/e1'), { amount: 50000, concept: 'nafta' });
  await setDoc(doc(db, 'settlements/s1'), { amount: 120000 });
  await setDoc(doc(db, 'coupons/PROMO10'), { active: true, value: 10, usedCount: 3 });
  await setDoc(doc(db, 'support_chats/cliente2'), { userId: 'cliente2', messages: [] });
  await setDoc(doc(db, 'offers/of1'), { title: 'Promo', active: true });
  await setDoc(doc(db, 'platformCategories/cat1'), { name: 'Comida' });
  await setDoc(doc(db, 'delivery_applications/cliente1'), { userId: 'cliente1', dni: '12345678' });
  await setDoc(doc(db, 'chats/o1_client-delivery'), { participants: ['cliente1', 'cadete1'], orderId: 'o1' });
  await setDoc(doc(db, 'users/usuarioViejo'), { role: 'user', displayName: 'Cuenta vieja sin clientId' });
  // Cuentas viejas con el número GO guardado vacío o en null: el perfil lo completa.
  await setDoc(doc(db, 'users/goIdVacio'), { role: 'user', displayName: 'Sin número', goId: '' });
  await setDoc(doc(db, 'users/goIdNull'), { role: 'user', displayName: 'Número null', goId: null });
  await setDoc(doc(db, 'settings/users'), { lastGoId: 1500 });
  await setDoc(doc(db, 'users/appleTester'), { role: 'user', email: 'test-delivery@godelivery.com' });
});

const anon = env.unauthenticatedContext().firestore();
const cliente1 = env.authenticatedContext('cliente1', { email: 'c1@mail.com' }).firestore();
const cliente2 = env.authenticatedContext('cliente2', { email: 'c2@mail.com' }).firestore();
const cadete1 = env.authenticatedContext('cadete1', { email: 'cad@mail.com' }).firestore();
const duenoPizza = env.authenticatedContext('duenoPizza', { email: 'pizza@mail.com' }).firestore();
const jefe = env.authenticatedContext('jefe', { email: 'kioscopaulos7@gmail.com' }).firestore();
const nuevo = env.authenticatedContext('nuevoUsuario', { email: 'n@mail.com' }).firestore();
const nuevo2 = env.authenticatedContext('nuevoUsuario2', { email: 'n2@mail.com' }).firestore();
const viejo = env.authenticatedContext('usuarioViejo', { email: 'viejo@mail.com' }).firestore();
const apple = env.authenticatedContext('appleTester', { email: 'test-delivery@godelivery.com' }).firestore();

let pass = 0, fail = 0;
const failures = [];

async function check(label, promise) {
  try {
    await promise;
    pass++;
    console.log('  OK   ' + label);
  } catch (e) {
    fail++;
    failures.push(label + '  ->  ' + (e.message || e).toString().split('\n')[0].slice(0, 160));
    console.log('  FALLA ' + label);
  }
}

console.log('');
console.log('=========== ATAQUES QUE DEBEN SER BLOQUEADOS ===========');

await check('anonimo NO puede listar la base de usuarios',
  assertFails(getDocs(collection(anon, 'users'))));
await check('anonimo NO puede leer un usuario puntual',
  assertFails(getDoc(doc(anon, 'users/cliente1'))));
await check('anonimo NO puede escribir un usuario',
  assertFails(setDoc(doc(anon, 'users/cliente1'), { role: 'admin' })));
await check('anonimo NO puede leer pedidos',
  assertFails(getDocs(collection(anon, 'orders'))));
await check('anonimo NO puede borrar un pedido',
  assertFails(deleteDoc(doc(anon, 'orders/o1'))));
await check('anonimo NO puede borrar un comercio',
  assertFails(deleteDoc(doc(anon, 'comercios/pizza'))));
await check('anonimo NO puede tocar la configuracion global',
  assertFails(setDoc(doc(anon, 'settings/global'), { deliveryCost: 0 })));

await check('usuario comun NO puede listar todos los usuarios',
  assertFails(getDocs(collection(cliente1, 'users'))));
await check('usuario NO puede auto-ascenderse a admin',
  assertFails(updateDoc(doc(cliente1, 'users/cliente1'), { role: 'admin' })));
await check('usuario NO puede ponerse isAdmin=true',
  assertFails(updateDoc(doc(cliente1, 'users/cliente1'), { isAdmin: true })));
await check('usuario NO puede auto-aprobarse como cadete',
  assertFails(updateDoc(doc(cliente1, 'users/cliente1'), { deliveryStatus: 'approved' })));
await check('usuario NO puede auto-aprobarse como comercio',
  assertFails(updateDoc(doc(cliente1, 'users/cliente1'), { commerceStatus: 'approved' })));
await check('usuario NO puede eximirse del canon',
  assertFails(updateDoc(doc(cliente1, 'users/cliente1'), { isCanonExempt: true })));
await check('usuario NO puede cambiar el telefono de otro',
  assertFails(updateDoc(doc(cliente1, 'users/cliente2'), { phone: '000' })));
await check('usuario NO puede borrar a otro usuario',
  assertFails(deleteDoc(doc(cliente1, 'users/cliente2'))));
await check('usuario NO puede leer el pedido de un vecino',
  assertFails(getDoc(doc(cliente1, 'orders/o2'))));
await check('usuario NO puede borrar un pedido',
  assertFails(deleteDoc(doc(cliente1, 'orders/o1'))));
await check('usuario NO puede cambiar la configuracion global',
  assertFails(setDoc(doc(cliente1, 'settings/global'), { deliveryCost: 0 })));
await check('usuario NO puede ver los gastos de la empresa',
  assertFails(getDocs(collection(cliente1, 'company_expenses'))));
await check('usuario NO puede ver las liquidaciones',
  assertFails(getDoc(doc(cliente1, 'settlements/s1'))));
await check('usuario NO puede leer el chat de soporte de otro',
  assertFails(getDoc(doc(cliente1, 'support_chats/cliente2'))));
await check('usuario NO puede leer la documentacion (DNI) de otro postulante',
  assertFails(getDoc(doc(cliente2, 'delivery_applications/cliente1'))));
await check('usuario NO puede crear cupones',
  assertFails(setDoc(doc(cliente1, 'coupons/GRATIS100'), { active: true, value: 100 })));
await check('usuario NO puede borrar cupones',
  assertFails(deleteDoc(doc(cliente1, 'coupons/PROMO10'))));
await check('usuario NO puede editar el catalogo de un comercio',
  assertFails(setDoc(doc(cliente1, 'comercios/pizza/products/p1'), { price: 1 })));
await check('usuario NO puede crearse como comercio ajeno',
  assertFails(updateDoc(doc(cliente1, 'comercios/pizza'), { name: 'hackeado' })));
await check('usuario NO puede entrar a un chat que no es suyo',
  assertFails(getDoc(doc(cliente2, 'chats/o1_client-delivery'))));
await check('comercio NO puede editar el comercio de al lado',
  assertFails(updateDoc(doc(duenoPizza, 'comercios/kiosco'), { isActive: false })));
await check('comercio NO puede tocar el catalogo del de al lado',
  assertFails(setDoc(doc(duenoPizza, 'comercios/kiosco/products/x'), { name: 'x' })));
await check('comercio NO puede leer los gastos de la empresa',
  assertFails(getDocs(collection(duenoPizza, 'company_expenses'))));
await check('cadete NO puede ascenderse a admin',
  assertFails(updateDoc(doc(cadete1, 'users/cadete1'), { role: 'admin' })));
await check('cadete NO puede borrar pedidos',
  assertFails(deleteDoc(doc(cadete1, 'orders/o2'))));

console.log('');
console.log('=========== FLUJOS REALES QUE DEBEN SEGUIR ANDANDO ===========');

await check('visitante sin login ve el catalogo de comercios',
  assertSucceeds(getDocs(collection(anon, 'comercios'))));
await check('visitante sin login ve los productos de un comercio',
  assertSucceeds(getDocs(collection(anon, 'comercios/pizza/products'))));
await check('visitante sin login lee la configuracion de la app',
  assertSucceeds(getDoc(doc(anon, 'settings/global'))));
await check('visitante sin login ve las ofertas',
  assertSucceeds(getDocs(collection(anon, 'offers'))));
await check('visitante sin login ve las categorias',
  assertSucceeds(getDocs(collection(anon, 'platformCategories'))));

await check('usuario nuevo crea su perfil al registrarse',
  assertSucceeds(setDoc(doc(nuevo, 'users/nuevoUsuario'), {
    role: 'user', displayName: 'Nuevo', email: 'n@mail.com', clientId: 1234, referralCode: 'GO-REF-XYZ',
  })));
await check('usuario nuevo NO puede registrarse siendo admin',
  assertFails(setDoc(doc(nuevo2, 'users/nuevoUsuario2'), { role: 'admin', displayName: 'Vivo' })));
await check('usuario edita su propio perfil',
  assertSucceeds(updateDoc(doc(cliente1, 'users/cliente1'), { displayName: 'Juan', phone: '2214455' })));
await check('usuario guarda su direccion',
  assertSucceeds(updateDoc(doc(cliente1, 'users/cliente1'), { lastAddress: 'San Martin 100' })));
await check('usuario se postula como cadete (pending)',
  assertSucceeds(updateDoc(doc(cliente1, 'users/cliente1'), { deliveryStatus: 'pending', deliveryApplication: { dni: '123' } })));
await check('usuario se postula como comercio (pending)',
  assertSucceeds(updateDoc(doc(cliente1, 'users/cliente1'), { commerceStatus: 'pending' })));
await check('usuario lee su propio perfil',
  assertSucceeds(getDoc(doc(cliente1, 'users/cliente1'))));
await check('usuario lee el perfil del cadete que le lleva el pedido',
  assertSucceeds(getDoc(doc(cliente1, 'users/cadete1'))));
await check('usuario consulta sus propios pedidos',
  assertSucceeds(getDocs(query(collection(cliente1, 'orders'), where('userId', '==', 'cliente1')))));
await check('usuario lee su pedido',
  assertSucceeds(getDoc(doc(cliente1, 'orders/o1'))));
await check('usuario cancela su pedido',
  assertSucceeds(updateDoc(doc(cliente1, 'orders/o1'), { status: 'cancelled', cancelReason: 'me arrepenti' })));
await check('usuario califica al cadete (ratings en otro perfil)',
  assertSucceeds(updateDoc(doc(cliente1, 'users/cadete1'), { ratings: [{ rating: 5 }] })));
await check('referido: sumar puntos a otro usuario',
  assertSucceeds(updateDoc(doc(cliente1, 'users/cliente2'), { points: 50 })));
await check('usuario registra su visita diaria (telemetria)',
  assertSucceeds(setDoc(doc(cliente1, 'visits/cliente1_2026-09-16'), { userId: 'cliente1', date: '2026-09-16' })));
await check('usuario guarda su token de notificaciones',
  assertSucceeds(setDoc(doc(cliente1, 'users/cliente1/fcmTokens/tok1'), { token: 'abc' })));
await check('usuario lee sus notificaciones',
  assertSucceeds(getDocs(collection(cliente1, 'users/cliente1/notifications'))));
await check('usuario canjea un cupon',
  assertSucceeds(setDoc(doc(cliente1, 'coupons/PROMO10/redemptions/cliente1'), { usedAt: 'hoy' })));
await check('usuario lee un cupon para validarlo',
  assertSucceeds(getDoc(doc(cliente1, 'coupons/PROMO10'))));
await check('usuario abre el contador de clientes al registrarse',
  assertSucceeds(getDoc(doc(cliente1, 'counters/users'))));
await check('usuario escribe en el chat de su pedido',
  assertSucceeds(addDoc(collection(cliente1, 'chats/o1_client-delivery/messages'), { text: 'hola' })));
await check('usuario abre un ticket de soporte',
  assertSucceeds(setDoc(doc(cliente1, 'support_chats/cliente1'), { userId: 'cliente1', messages: [] })));
await check('usuario publica una resena',
  assertSucceeds(setDoc(doc(cliente1, 'reviews/r1'), { userId: 'cliente1', rating: 5 })));
await check('usuario clickea un banner (contador)',
  assertSucceeds(setDoc(doc(cliente1, 'points_transactions/t1'), { userId: 'cliente1', points: 10 })));

await check('cadete ve la bolsa de pedidos disponibles',
  assertSucceeds(getDocs(query(collection(cadete1, 'orders'), where('status', 'in', ['ready', 'preparing', 'confirmed', 'pending'])))));
await check('cadete ve sus pedidos asignados',
  assertSucceeds(getDocs(query(collection(cadete1, 'orders'), where('driverId', '==', 'cadete1')))));
await check('cadete toma un pedido',
  assertSucceeds(updateDoc(doc(cadete1, 'orders/o2'), { driverId: 'cadete1', status: 'on_the_way' })));
await check('cadete se conecta (isOnline)',
  assertSucceeds(updateDoc(doc(cadete1, 'users/cadete1'), { isOnline: true, currentLocation: { lat: -35, lng: -57 } })));
await check('cadete abre una sesion de trabajo',
  assertSucceeds(setDoc(doc(cadete1, 'deliverySessions/sess1'), { driverId: 'cadete1', startedAt: 'hoy' })));
await check('cadete NO registra su cuota diaria (la cobra el servidor)',
  assertFails(setDoc(doc(cadete1, 'delivery_canon_payments/c1'), { driverId: 'cadete1', amount: 5000 })));
await check('cadete busca a los admins para avisarles',
  assertSucceeds(getDocs(query(collection(cadete1, 'users'), where('role', '==', 'admin')))));
await check('cadete califica al cliente',
  assertSucceeds(updateDoc(doc(cadete1, 'users/cliente1'), { ratings: [{ rating: 5 }] })));

await check('comercio ve los pedidos de su local',
  assertSucceeds(getDocs(query(collection(duenoPizza, 'orders'), where('comercioId', '==', 'pizza')))));
await check('comercio acepta un pedido',
  assertSucceeds(updateDoc(doc(duenoPizza, 'orders/o3'), { status: 'preparing' })));
await check('comercio edita su catalogo',
  assertSucceeds(setDoc(doc(duenoPizza, 'comercios/pizza/products/p1'), { name: 'Muzza', price: 13000 })));
await check('comercio edita sus datos',
  assertSucceeds(updateDoc(doc(duenoPizza, 'comercios/pizza'), { isActive: false })));
await check('comercio crea un cupon',
  assertSucceeds(setDoc(doc(duenoPizza, 'coupons/PIZZA20'), { ownerId: 'pizza', value: 20 })));
await check('comercio crea una oferta',
  assertSucceeds(addDoc(collection(duenoPizza, 'offers'), { title: 'Promo 2x1' })));

await check('admin lista todos los usuarios',
  assertSucceeds(getDocs(collection(jefe, 'users'))));
await check('admin aprueba a un cadete',
  assertSucceeds(updateDoc(doc(jefe, 'users/cliente1'), { deliveryStatus: 'approved', role: 'delivery' })));
await check('admin cambia la configuracion global',
  assertSucceeds(setDoc(doc(jefe, 'settings/global'), { deliveryCost: 1800 })));
await check('admin ve los gastos',
  assertSucceeds(getDocs(collection(jefe, 'company_expenses'))));
await check('admin ve las liquidaciones',
  assertSucceeds(getDocs(collection(jefe, 'settlements'))));
await check('admin lee la documentacion de un postulante',
  assertSucceeds(getDoc(doc(jefe, 'delivery_applications/cliente1'))));
await check('admin borra un pedido',
  assertSucceeds(deleteDoc(doc(jefe, 'orders/o3'))));

console.log('');
console.log('=========== MARKETPLACE Y TELEMETRIA ===========');

await check('publicacion del marketplace es visible sin login',
  assertSucceeds(getDocs(collection(anon, 'marketplace_products'))));
await check('vendedor publica su producto',
  assertSucceeds(setDoc(doc(cliente1, 'marketplace_products/mp1'), { sellerId: 'cliente1', title: 'Bici', status: 'active' })));
await check('vendedor marca su producto como vendido',
  assertSucceeds(updateDoc(doc(cliente1, 'marketplace_products/mp1'), { status: 'sold' })));
await check('un tercero NO puede marcar vendida la publicacion ajena',
  assertFails(updateDoc(doc(cliente2, 'marketplace_products/mp1'), { status: 'sold' })));
await check('un tercero NO puede borrar la publicacion ajena',
  assertFails(deleteDoc(doc(cliente2, 'marketplace_products/mp1'))));
await check('usuario NO puede leer la telemetria de visitas',
  assertFails(getDocs(collection(cliente1, 'visits'))));
await check('usuario NO puede leer las postulaciones de empleo',
  assertFails(getDocs(collection(cliente1, 'job_applications'))));
await check('usuario NO puede leer los pagos de canon de los cadetes',
  assertFails(getDocs(collection(cliente1, 'delivery_canon_payments'))));
await check('anonimo NO puede leer los chats',
  assertFails(getDocs(collection(anon, 'chats'))));
await check('anonimo NO puede leer cupones',
  assertFails(getDoc(doc(anon, 'coupons/PROMO10'))));

console.log('');
console.log('=========== BUSQUEDAS GLOBALES (collection group) ===========');

await check('buscador global de productos funciona sin login',
  assertSucceeds(getDocs(collectionGroup(anon, 'products'))));
await check('buscador global de productos funciona con login',
  assertSucceeds(getDocs(collectionGroup(cliente1, 'products'))));
await check('home filtra productos exclusivos de la app sin login',
  assertSucceeds(getDocs(query(collectionGroup(anon, 'products'), where('onlyInApp', '==', true)))));
await check('admin junta todos los tokens para el push masivo',
  assertSucceeds(getDocs(collectionGroup(jefe, 'fcmTokens'))));
await check('usuario comun NO puede juntar los tokens de todos',
  assertFails(getDocs(collectionGroup(cliente1, 'fcmTokens'))));
await check('admin lee todos los pedidos (metricas)',
  assertSucceeds(getDocs(collection(jefe, 'orders'))));
await check('admin lee la telemetria de visitas',
  assertSucceeds(getDocs(collection(jefe, 'visits'))));

console.log('');
console.log('=========== LOGIN DE CUENTAS VIEJAS Y CUENTA DE REVISION ===========');

await check('usuario viejo completa su clientId y codigo de referido al entrar',
  assertSucceeds(setDoc(doc(viejo, 'users/usuarioViejo'), { clientId: 1050, referralCode: 'GO-REF-ABC', deviceOS: 'ios' }, { merge: true })));
await check('usuario NO puede cambiar su codigo de referido ya asignado',
  assertFails(updateDoc(doc(viejo, 'users/usuarioViejo'), { referralCode: 'GO-REF-TRUCHO' })));
await check('usuario NO puede cambiar su numero de cliente ya asignado',
  assertFails(updateDoc(doc(viejo, 'users/usuarioViejo'), { clientId: 1 })));
// Lo mismo que hace profile.js al abrir el perfil sin número GO (Admin → Errores, 16-10-2026:
// "Error assigning goId inside profile: permission-denied" seguía con el código nuevo).
const assignGoId = (fs, uid) => runTransaction(fs, async (t) => {
  const cRef = doc(fs, 'counters', 'users');
  const uRef = doc(fs, 'users', uid);
  const [cSnap, sSnap] = await Promise.all([t.get(cRef), t.get(doc(fs, 'settings', 'users')), t.get(uRef)]);
  const last = Math.max(cSnap.exists() ? Number(cSnap.data().lastGoId) || 0 : 0, sSnap.exists() ? Number(sSnap.data().lastGoId) || 0 : 0, 1000) + 1;
  t.update(uRef, { goId: `GO-${last}` });
  t.set(cRef, { lastGoId: last }, { merge: true });
});
await check('usuario sin numero GO se lo asigna desde el perfil',
  assertSucceeds(assignGoId(viejo, 'usuarioViejo')));
await check('usuario con numero GO vacio se lo asigna desde el perfil',
  assertSucceeds(assignGoId(env.authenticatedContext('goIdVacio').firestore(), 'goIdVacio')));
await check('usuario con numero GO en null se lo asigna desde el perfil',
  assertSucceeds(assignGoId(env.authenticatedContext('goIdNull').firestore(), 'goIdNull')));
await check('usuario NO puede cambiar su numero GO ya asignado',
  assertFails(updateDoc(doc(viejo, 'users/usuarioViejo'), { goId: 'GO-1' })));
await check('cuenta de revision de Apple se habilita como cadete de prueba',
  assertSucceeds(setDoc(doc(apple, 'users/appleTester'), { role: 'admin', isDelivery: true, deliveryStatus: 'approved', deliveryId: 'DL-TEST' }, { merge: true })));
await check('otra cuenta NO puede hacer lo mismo que la de revision',
  assertFails(setDoc(doc(cliente2, 'users/cliente2'), { role: 'admin', isDelivery: true, deliveryStatus: 'approved' }, { merge: true })));

console.log('');
console.log('=========== CHATS: SOLO LOS INVOLUCRADOS ===========');

await check('cliente entra al chat de su pedido',
  assertSucceeds(getDoc(doc(cliente1, 'chats/o1_client-delivery'))));
await check('cadete entra al chat del pedido',
  assertSucceeds(getDoc(doc(cadete1, 'chats/o1_client-delivery'))));
await check('comercio entra a su chat con el cliente aunque no figure en participants',
  assertSucceeds(getDoc(doc(duenoPizza, 'chats/o1_client-commerce'))));
await check('el comercio NO entra al chat privado cliente↔cadete',
  assertFails(getDoc(doc(duenoPizza, 'chats/o1_client-delivery'))));
await check('un vecino ajeno NO entra al chat',
  assertFails(getDoc(doc(cliente2, 'chats/o1_client-delivery'))));
await check('cliente lee los mensajes de su chat',
  assertSucceeds(getDocs(collection(cliente1, 'chats/o1_client-delivery/messages'))));
await check('comercio lee los mensajes de su chat con el cliente',
  assertSucceeds(getDocs(collection(duenoPizza, 'chats/o1_client-commerce/messages'))));
await check('el comercio NO lee los mensajes del chat cliente↔cadete',
  assertFails(getDocs(collection(duenoPizza, 'chats/o1_client-delivery/messages'))));
await check('el cadete NO lee los mensajes del chat cliente↔comercio',
  assertFails(getDocs(collection(cadete1, 'chats/o1_client-commerce/messages'))));
await check('un vecino ajeno NO lee los mensajes del chat',
  assertFails(getDocs(collection(cliente2, 'chats/o1_client-delivery/messages'))));
await check('un vecino ajeno NO escribe en el chat',
  assertFails(addDoc(collection(cliente2, 'chats/o1_client-delivery/messages'), { text: 'me cuelo' })));
await check('cliente lee los mensajes internos de su pedido',
  assertSucceeds(getDocs(collection(cliente1, 'orders/o1/messages'))));
await check('un vecino ajeno NO lee los mensajes internos del pedido',
  assertFails(getDocs(collection(cliente2, 'orders/o1/messages'))));
await check('duenio del ticket lee sus mensajes de soporte',
  assertSucceeds(getDocs(collection(cliente2, 'support_chats/cliente2/messages'))));
await check('un tercero NO lee los mensajes de soporte ajenos',
  assertFails(getDocs(collection(cliente1, 'support_chats/cliente2/messages'))));

console.log('');
console.log('=========== UBICACION EN VIVO DEL CADETE (orders/{id}/live/driver) ===========');

const livePos = () => ({ lat: -35.08, lng: -57.51, heading: 90, speed: 5, updatedAt: new Date() });
// Pedidos propios: los tests de arriba borran o3 y le asignan o2 al cadete.
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, 'orders/o4'), { userId: 'cliente1', comercioId: 'pizza', status: 'delivering', driverId: 'cadete1', total: 9000 });
  await setDoc(doc(db, 'orders/o5'), { userId: 'cliente2', comercioId: 'kiosco', status: 'ready', total: 5000 });
});
await check('cadete asignado escribe su ubicacion en vivo',
  assertSucceeds(setDoc(doc(cadete1, 'orders/o4/live/driver'), livePos())));
await check('cliente del pedido lee la ubicacion en vivo',
  assertSucceeds(getDoc(doc(cliente1, 'orders/o4/live/driver'))));
await check('comercio del pedido lee la ubicacion en vivo',
  assertSucceeds(getDoc(doc(duenoPizza, 'orders/o4/live/driver'))));
await check('un vecino ajeno NO lee la ubicacion en vivo',
  assertFails(getDoc(doc(cliente2, 'orders/o4/live/driver'))));
await check('anonimo NO lee la ubicacion en vivo',
  assertFails(getDoc(doc(anon, 'orders/o4/live/driver'))));
await check('cadete NO escribe ubicacion en un pedido que no es suyo',
  assertFails(setDoc(doc(cadete1, 'orders/o5/live/driver'), livePos())));
await check('cliente NO puede falsear la ubicacion del cadete',
  assertFails(setDoc(doc(cliente1, 'orders/o4/live/driver'), livePos())));
await check('cadete manda la hora de la lectura del GPS y la precision',
  assertSucceeds(setDoc(doc(cadete1, 'orders/o4/live/driver'), { ...livePos(), fixAt: Date.now(), accuracy: 6.5 })));
await check('cadete NO manda una hora de lectura que no es un numero',
  assertFails(setDoc(doc(cadete1, 'orders/o4/live/driver'), { ...livePos(), fixAt: 'ayer' })));
await check('cadete NO mete campos extra en la ubicacion',
  assertFails(setDoc(doc(cadete1, 'orders/o4/live/driver'), { ...livePos(), status: 'completed' })));
await check('cadete NO escribe otro doc que no sea "driver"',
  assertFails(setDoc(doc(cadete1, 'orders/o4/live/otro'), livePos())));

console.log('=========== LIQUIDACIONES Y DEUDA DEL CADETE ===========');

await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await updateDoc(doc(db, 'users/cadete1'), { deliveryDebt: 5000 });
  await setDoc(doc(db, 'delivery_debt_settlements/ds1'), { driverId: 'cadete1', amount: 1000 });
  await setDoc(doc(db, 'delivery_debt_settlements/ds2'), { driverId: 'otroCadete', amount: 1000 });
});
await check('admin registra una liquidacion de deuda',
  assertSucceeds(setDoc(doc(jefe, 'delivery_debt_settlements/ds3'), { driverId: 'cadete1', amount: 5000 })));
await check('admin lista el historial de liquidaciones',
  assertSucceeds(getDocs(collection(jefe, 'delivery_debt_settlements'))));
await check('cadete lee su propia liquidacion',
  assertSucceeds(getDoc(doc(cadete1, 'delivery_debt_settlements/ds1'))));
await check('cadete NO lee la liquidacion de otro',
  assertFails(getDoc(doc(cadete1, 'delivery_debt_settlements/ds2'))));
await check('cadete NO se registra una liquidacion a si mismo',
  assertFails(setDoc(doc(cadete1, 'delivery_debt_settlements/trampa'), { driverId: 'cadete1', amount: 99999 })));
await check('cliente NO lee liquidaciones',
  assertFails(getDoc(doc(cliente1, 'delivery_debt_settlements/ds1'))));
await check('cadete NO se toca la deuda, ni siquiera para subirla',
  assertFails(updateDoc(doc(cadete1, 'users/cadete1'), { deliveryDebt: 7000 })));
await check('cadete NO marca la cuota de hoy como cobrada',
  assertFails(updateDoc(doc(cadete1, 'users/cadete1'), { lastCanonChargeDate: '2026-09-25' })));
await check('cadete sigue pudiendo conectarse',
  assertSucceeds(updateDoc(doc(cadete1, 'users/cadete1'), { isOnline: true })));
await env.withSecurityRulesDisabled(async (ctx) => {
  await setDoc(doc(ctx.firestore(), 'delivery_canon_payments/cadete1_2026-09-25'), { driverId: 'cadete1', amount: 2000, status: 'pending', settled: false });
});
await check('cadete lee su cuota diaria',
  assertSucceeds(getDoc(doc(cadete1, 'delivery_canon_payments/cadete1_2026-09-25'))));
await check('cadete NO se marca la cuota como pagada',
  assertFails(updateDoc(doc(cadete1, 'delivery_canon_payments/cadete1_2026-09-25'), { settled: true, status: 'paid' })));
await check('cadete NO inventa movimientos',
  assertFails(setDoc(doc(cadete1, 'delivery_transactions/trampa'), { driverId: 'cadete1', type: 'liquidation', amount: -5000 })));
await check('admin marca la cuota de hoy como pagada',
  assertSucceeds(updateDoc(doc(jefe, 'delivery_canon_payments/cadete1_2026-09-25'), { settled: true, status: 'paid' })));
await check('admin registra un movimiento',
  assertSucceeds(setDoc(doc(jefe, 'delivery_transactions/t1'), { driverId: 'cadete1', type: 'liquidation', amount: -2000 })));
await check('cadete NO se borra la deuda',
  assertFails(updateDoc(doc(cadete1, 'users/cadete1'), { deliveryDebt: 0 })));
await check('cadete NO se baja la deuda',
  assertFails(updateDoc(doc(cadete1, 'users/cadete1'), { deliveryDebt: 6999 })));

console.log('=========== CUENTA CORRIENTE (driver_ledger) ===========');
// cadete1 debe 5000 y todavía no tiene libro: el primer movimiento abre su saldo inicial.
const opening = { driverId: 'cadete1', type: 'opening', amount: 5000, balanceAfter: 5000 };
const pay = (amount, balanceAfter, extra = {}) => ({ driverId: 'cadete1', type: 'payment', amount, balanceAfter, ...extra });
const moveBatch = (db, entryId, entry, userFields, withOpening = true) => {
  const b = writeBatch(db);
  if (withOpening) b.set(doc(db, 'driver_ledger/open_cadete1'), opening);
  b.set(doc(db, `driver_ledger/${entryId}`), entry);
  b.update(doc(db, 'users/cadete1'), { ledgerOpened: true, ledgerLastEntryId: entryId, ...userFields });
  return b.commit();
};
await check('admin NO pone la deuda en $0 sin dejar renglon',
  assertFails(updateDoc(doc(jefe, 'users/cadete1'), { deliveryDebt: 0 })));
await check('admin NO cobra con un saldo que no cierra',
  assertFails(moveBatch(jefe, 'pay_mal', pay(-2000, 2500), { deliveryDebt: 2500 })));
await check('admin NO registra un pago con signo al reves',
  assertFails(moveBatch(jefe, 'pay_signo', pay(2000, 7000), { deliveryDebt: 7000 })));
await check('admin NO abre un saldo inicial inventado',
  assertFails((() => {
    const b = writeBatch(jefe);
    b.set(doc(jefe, 'driver_ledger/open_cadete1'), { ...opening, amount: 1000, balanceAfter: 1000 });
    b.set(doc(jefe, 'driver_ledger/pay_x'), pay(-1000, 4000));
    b.update(doc(jefe, 'users/cadete1'), { ledgerOpened: true, ledgerLastEntryId: 'pay_x', deliveryDebt: 4000 });
    return b.commit();
  })()));
await check('admin cobra: renglon + saldo inicial + saldo nuevo en una operacion',
  assertSucceeds(moveBatch(jefe, 'pay_ok', pay(-2000, 3000), { deliveryDebt: 3000 })));
await check('un cobro de mas deja saldo a favor (negativo)',
  assertSucceeds(moveBatch(jefe, 'pay_extra', pay(-4000, -1000), { deliveryDebt: -1000 }, false)));
await check('admin NO reutiliza el id de un renglon',
  assertFails(moveBatch(jefe, 'pay_ok', pay(-500, -1500), { deliveryDebt: -1500 }, false)));
await check('admin le paga al cadete lo que tiene a favor',
  assertSucceeds(moveBatch(jefe, 'payout_1', { driverId: 'cadete1', type: 'payout', amount: 1000, balanceAfter: 0 }, { deliveryDebt: 0 }, false)));
await check('admin NO escribe renglones de pedido o cuota (son del servidor)',
  assertFails(moveBatch(jefe, 'canon_trampa', { driverId: 'cadete1', type: 'daily_fee', amount: 2000, balanceAfter: 2000 }, { deliveryDebt: 2000 }, false)));
await check('cadete lee sus renglones',
  assertSucceeds(getDocs(query(collection(cadete1, 'driver_ledger'), where('driverId', '==', 'cadete1')))));
await check('cliente NO lee renglones de un cadete',
  assertFails(getDoc(doc(cliente1, 'driver_ledger/pay_ok'))));
await check('cadete NO se escribe un renglon',
  assertFails(setDoc(doc(cadete1, 'driver_ledger/trampa'), pay(-9999, 0))));
await check('nadie borra un renglon, ni el admin',
  assertFails(deleteDoc(doc(jefe, 'driver_ledger/pay_ok'))));
await check('admin NO edita el monto de un renglon',
  assertFails(updateDoc(doc(jefe, 'driver_ledger/pay_ok'), { amount: -1 })));
await check('admin anula un cobro con su renglon inverso',
  assertSucceeds((() => {
    const b = writeBatch(jefe);
    b.set(doc(jefe, 'driver_ledger/rev_pay_ok'), { driverId: 'cadete1', type: 'reversal', amount: 2000, balanceAfter: 2000, reversesId: 'pay_ok' });
    b.update(doc(jefe, 'driver_ledger/pay_ok'), { reversedById: 'rev_pay_ok' });
    b.update(doc(jefe, 'users/cadete1'), { ledgerLastEntryId: 'rev_pay_ok', deliveryDebt: 2000 });
    return b.commit();
  })()));
await check('admin sigue editando otros datos del cadete',
  assertSucceeds(updateDoc(doc(jefe, 'users/cadete1'), { displayName: 'Cadete Uno' })));

console.log('');
console.log('=========== LUGARES DE MANDADOS ===========');
const lugar = (extra = {}) => ({ name: 'Farmacia Pasteur', slug: 'farmacia-pasteur', category: 'farmacia', lat: -35.08, lng: -57.515, samples: [{ lat: -35.08, lng: -57.515, at: 1 }], visits: 1, verified: false, lastDriverUid: 'cadete1', support: 1, conflict: false, ...extra });
await check('cadete aprende un lugar nuevo',
  assertSucceeds(setDoc(doc(cadete1, 'mandadoPlaces/farmacia-pasteur'), lugar())));
await check('cadete suma una visita',
  assertSucceeds(setDoc(doc(cadete1, 'mandadoPlaces/farmacia-pasteur'), lugar({ visits: 2, lat: -35.0801 }))));
await check('cliente lee los lugares (para las sugerencias)',
  assertSucceeds(getDocs(collection(cliente1, 'mandadoPlaces'))));
await check('anonimo NO lee los lugares',
  assertFails(getDocs(collection(anon, 'mandadoPlaces'))));
await check('cliente NO escribe lugares',
  assertFails(setDoc(doc(cliente2, 'mandadoPlaces/trampa'), lugar({ slug: 'trampa', lastDriverUid: 'cliente2' }))));
await check('cadete NO confirma un lugar',
  assertFails(setDoc(doc(cadete1, 'mandadoPlaces/farmacia-pasteur'), lugar({ verified: true }))));
await check('cadete NO firma por otro',
  assertFails(setDoc(doc(cadete1, 'mandadoPlaces/farmacia-pasteur'), lugar({ lastDriverUid: 'otro' }))));
await check('cadete NO renombra un lugar',
  assertFails(setDoc(doc(cadete1, 'mandadoPlaces/farmacia-pasteur'), lugar({ name: 'Otra cosa' }))));
await check('cadete NO pone un lugar fuera de Magdalena',
  assertFails(setDoc(doc(cadete1, 'mandadoPlaces/lejos'), lugar({ slug: 'lejos', lat: -34.6037, lng: -58.3816 }))));
await check('cadete NO agrega campos raros',
  assertFails(setDoc(doc(cadete1, 'mandadoPlaces/farmacia-pasteur'), lugar({ precio: 1 }))));
await check('cadete NO borra lugares',
  assertFails(deleteDoc(doc(cadete1, 'mandadoPlaces/farmacia-pasteur'))));
await check('admin confirma un lugar',
  assertSucceeds(updateDoc(doc(jefe, 'mandadoPlaces/farmacia-pasteur'), { verified: true })));
await check('cadete NO mueve un lugar confirmado',
  assertFails(setDoc(doc(cadete1, 'mandadoPlaces/farmacia-pasteur'), lugar({ verified: true, lat: -35.09 }))));
await check('cadete suma visita a un lugar confirmado sin moverlo',
  assertSucceeds(setDoc(doc(cadete1, 'mandadoPlaces/farmacia-pasteur'), lugar({ verified: true, lat: -35.0801, visits: 3 }))));
await check('admin borra un lugar',
  assertSucceeds(deleteDoc(doc(jefe, 'mandadoPlaces/farmacia-pasteur'))));

console.log('');
console.log('=========== PANEL DE COMERCIO: COMISION, DESTAQUE Y PIN ===========');

await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, 'comercios/pizzaPin'), { name: 'Pizza con PIN', ownerId: 'duenoPizza', pin: '1234', commissionRate: 0.12 });
  await setDoc(doc(db, 'comercios/pizzaPin/private/access'), { pin: '4321' });
  await setDoc(doc(db, 'orders/o9'), { userId: 'cliente1', comercioId: 'pizza', status: 'pending', total: 8000, commissionAmount: 800, commissionStatus: 'pending' });
});

await check('comercio NO puede bajarse la comision',
  assertFails(updateDoc(doc(duenoPizza, 'comercios/pizza'), { commissionRate: 0 })));
await check('comercio NO puede auto-destacarse gratis',
  assertFails(updateDoc(doc(duenoPizza, 'comercios/pizza'), { promotion: { active: true, isPriority: true } })));
await check('comercio NO puede inflarse la calificacion',
  assertFails(updateDoc(doc(duenoPizza, 'comercios/pizza'), { ratingAverage: 5, ratingCount: 999 })));
await check('comercio NO puede regalarle su local a otro',
  assertFails(updateDoc(doc(duenoPizza, 'comercios/pizza'), { ownerId: 'cliente1' })));
await check('comercio NO puede volver a poner el PIN en el doc publico',
  assertFails(updateDoc(doc(duenoPizza, 'comercios/pizza'), { pin: '1111' })));
await check('usuario NO puede crearse un comercio con comision propia',
  assertFails(setDoc(doc(nuevo, 'comercios/trucho'), { name: 'Trucho', ownerId: 'nuevoUsuario', commissionRate: 0 })));
// Formulario "Sumá tu comercio" (src/pages/home.js): el comercio nace pendiente y apagado.
const solicitud = { name: 'Rotiseria Nueva', ownerId: 'nuevoUsuario', category: 'Comida', isActive: false, approvedByAdmin: false };
await check('usuario se postula con su comercio (pendiente y apagado)',
  assertSucceeds(setDoc(doc(nuevo, 'comercios/solicitud1'), solicitud)));
await check('usuario NO puede crearse un comercio ya aprobado',
  assertFails(setDoc(doc(nuevo, 'comercios/solicitud2'), { ...solicitud, approvedByAdmin: true })));
await check('usuario NO puede crearse un comercio visible sin aprobar',
  assertFails(setDoc(doc(nuevo, 'comercios/solicitud3'), { ...solicitud, isActive: true })));
await check('el postulante edita su solicitud',
  assertSucceeds(updateDoc(doc(nuevo, 'comercios/solicitud1'), { description: 'La mejor' })));
await check('el postulante NO puede ponerse visible antes de que lo aprueben',
  assertFails(updateDoc(doc(nuevo, 'comercios/solicitud1'), { isActive: true })));
await check('el postulante NO puede aprobarse solo',
  assertFails(updateDoc(doc(nuevo, 'comercios/solicitud1'), { approvedByAdmin: true })));
await check('admin aprueba y activa la solicitud',
  assertSucceeds(updateDoc(doc(jefe, 'comercios/solicitud1'), { approvedByAdmin: true, isActive: true })));
await check('comercio NO puede marcar pagada la comision de su pedido',
  assertFails(updateDoc(doc(duenoPizza, 'orders/o9'), { commissionStatus: 'paid' })));
await check('comercio NO puede bajar la comision de su pedido',
  assertFails(updateDoc(doc(duenoPizza, 'orders/o9'), { commissionAmount: 0 })));
await check('comercio NO puede borrar sus pedidos (y con ellos la comision)',
  assertFails(deleteDoc(doc(duenoPizza, 'orders/o9'))));
await check('cliente marca que ya vio la guia de la app',
  assertSucceeds(updateDoc(doc(cliente1, 'users/cliente1'), { clientTourDone: true })));
await check('cadete marca que ya vio su guia',
  assertSucceeds(updateDoc(doc(cadete1, 'users/cadete1'), { driverTourDone: true })));
await check('comercio marca que ya vio la guia del panel',
  assertSucceeds(updateDoc(doc(duenoPizza, 'users/duenoPizza'), { commercePanelTourDone: true })));
await check('otro comercio NO puede leer el PIN ajeno',
  assertFails(getDoc(doc(cliente1, 'comercios/pizzaPin/private/access'))));
await check('anonimo NO puede leer el PIN',
  assertFails(getDoc(doc(anon, 'comercios/pizzaPin/private/access'))));

await check('comercio pausa su local aunque todavia tenga el PIN viejo',
  assertSucceeds(updateDoc(doc(duenoPizza, 'comercios/pizzaPin'), { isPaused: true })));
await check('comercio lee su PIN privado',
  assertSucceeds(getDoc(doc(duenoPizza, 'comercios/pizzaPin/private/access'))));
await check('comercio cambia su PIN privado',
  assertSucceeds(setDoc(doc(duenoPizza, 'comercios/pizzaPin/private/access'), { pin: '5555' })));
await check('comercio saca el PIN viejo del doc publico',
  assertSucceeds(updateDoc(doc(duenoPizza, 'comercios/pizzaPin'), { pin: deleteField() })));
await check('comercio acepta con tiempo de preparacion',
  assertSucceeds(updateDoc(doc(duenoPizza, 'orders/o9'), { status: 'confirmed', preparationTimeMinutes: 20 })));
await check('comercio modifica los productos de su pedido',
  assertSucceeds(updateDoc(doc(duenoPizza, 'orders/o9'), { items: [], subtotal: 7000, total: 7000 })));
await check('admin ajusta la comision de un comercio',
  assertSucceeds(updateDoc(doc(jefe, 'comercios/pizza'), { commissionRate: 0.08 })));
await check('admin marca pagada la comision',
  assertSucceeds(updateDoc(doc(jefe, 'orders/o9'), { commissionStatus: 'paid' })));

console.log('');
console.log('=========== PERSONAS CON ACCESO A UN COMERCIO ===========');

// managerIds y private/team los escribe solo functions/commerce-access.js
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, 'comercios/kioscoEquipo'), { name: 'Kiosco con empleados', ownerId: 'duenoKiosco', managerIds: ['empleado1'], isActive: true });
  await setDoc(doc(db, 'comercios/kioscoEquipo/private/team'), { ownerEmail: 'kiosco@mail.com', members: [{ email: 'emp@mail.com', uid: 'empleado1' }] });
  await setDoc(doc(db, 'comercios/kioscoEquipo/private/access'), { pin: '1234' });
  await setDoc(doc(db, 'orders/oEquipo'), { userId: 'cliente1', comercioId: 'kioscoEquipo', status: 'pending', total: 4000, commissionAmount: 400 });
  await setDoc(doc(db, 'comercio_invites/kioscoEquipo__inv@mail.com'), { comercioId: 'kioscoEquipo', email: 'inv@mail.com', role: 'member' });
});
const empleado1 = env.authenticatedContext('empleado1', { email: 'emp@mail.com' }).firestore();
const duenoKiosco = env.authenticatedContext('duenoKiosco', { email: 'kiosco@mail.com' }).firestore();
const invitado = env.authenticatedContext('invitado1', { email: 'Inv@Mail.com' }).firestore();

await check('el empleado con acceso atiende los pedidos del comercio',
  assertSucceeds(updateDoc(doc(empleado1, 'orders/oEquipo'), { status: 'confirmed' })));
await check('el empleado con acceso edita el menu',
  assertSucceeds(setDoc(doc(empleado1, 'comercios/kioscoEquipo/products/p1'), { name: 'Alfajor', price: 900 })));
await check('el empleado con acceso pausa el local',
  assertSucceeds(updateDoc(doc(empleado1, 'comercios/kioscoEquipo'), { isPaused: true })));
await check('el empleado con acceso lee quien tiene acceso',
  assertSucceeds(getDoc(doc(empleado1, 'comercios/kioscoEquipo/private/team'))));
await check('el empleado NO puede sumarse a otros (managerIds)',
  assertFails(updateDoc(doc(empleado1, 'comercios/kioscoEquipo'), { managerIds: ['empleado1', 'cliente2'] })));
await check('el dueno NO puede tocar managerIds a mano (lo hace el servidor)',
  assertFails(updateDoc(doc(duenoKiosco, 'comercios/kioscoEquipo'), { managerIds: ['cliente2'] })));
await check('nadie escribe la lista de accesos desde la app',
  assertFails(setDoc(doc(duenoKiosco, 'comercios/kioscoEquipo/private/team'), { members: [] })));
await check('el dueno sigue cambiando su PIN',
  assertSucceeds(setDoc(doc(duenoKiosco, 'comercios/kioscoEquipo/private/access'), { pin: '9999' })));
await check('un cliente NO ve los pedidos del comercio con empleados',
  assertFails(getDoc(doc(cliente2, 'orders/oEquipo'))));
await check('el empleado de un comercio NO entra a otro',
  assertFails(updateDoc(doc(empleado1, 'comercios/pizza'), { isPaused: true })));
await check('el postulante NO puede crearse con accesos ya cargados',
  assertFails(setDoc(doc(nuevo2, 'comercios/solicitudEquipo'), { name: 'X', ownerId: 'nuevoUsuario2', isActive: false, approvedByAdmin: false, managerIds: ['nuevoUsuario2'] })));
await check('el postulante NO puede ponerse "compra el repartidor"',
  assertFails(setDoc(doc(nuevo2, 'comercios/solicitudShopper'), { name: 'X', ownerId: 'nuevoUsuario2', isActive: false, approvedByAdmin: false, fulfillmentMode: 'shopper' })));
await check('el invitado ve su invitacion (aunque escriba el correo con mayusculas)',
  assertSucceeds(getDocs(query(collection(invitado, 'comercio_invites'), where('email', '==', 'inv@mail.com')))));
await check('otro usuario NO ve invitaciones ajenas',
  assertFails(getDocs(query(collection(cliente1, 'comercio_invites'), where('email', '==', 'inv@mail.com')))));
await check('nadie crea invitaciones desde la app',
  assertFails(setDoc(doc(cliente1, 'comercio_invites/x'), { comercioId: 'kioscoEquipo', email: 'c1@mail.com', role: 'owner' })));

console.log('');
console.log('================================================');
console.log('  PASARON: ' + pass + '   |   FALLARON: ' + fail);
if (failures.length) {
  console.log('');
  console.log('  DETALLE DE LO QUE FALLO:');
  failures.forEach(f => console.log('   - ' + f));
}
console.log('================================================');

await env.cleanup();
process.exit(fail > 0 ? 1 : 0);
