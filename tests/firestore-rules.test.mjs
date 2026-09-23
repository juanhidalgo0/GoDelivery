import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, collectionGroup, query, where, getDocs, addDoc,
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

  await setDoc(doc(db, 'orders/o1'), { userId: 'cliente1', comercioId: 'pizza', status: 'pending', total: 15000 });
  await setDoc(doc(db, 'orders/o2'), { userId: 'cliente2', comercioId: 'kiosco', status: 'ready', total: 5000 });
  await setDoc(doc(db, 'orders/o3'), { userId: 'cliente1', comercioId: 'pizza', status: 'ready', driverId: 'cadete1', total: 9000 });

  await setDoc(doc(db, 'settings/global'), { deliveryCost: 1500 });
  await setDoc(doc(db, 'company_expenses/e1'), { amount: 50000, concept: 'nafta' });
  await setDoc(doc(db, 'settlements/s1'), { amount: 120000 });
  await setDoc(doc(db, 'coupons/BIENVENIDA'), { active: true, value: 10, usedCount: 3 });
  await setDoc(doc(db, 'support_chats/cliente2'), { userId: 'cliente2', messages: [] });
  await setDoc(doc(db, 'offers/of1'), { title: 'Promo', active: true });
  await setDoc(doc(db, 'platformCategories/cat1'), { name: 'Comida' });
  await setDoc(doc(db, 'delivery_applications/cliente1'), { userId: 'cliente1', dni: '12345678' });
  await setDoc(doc(db, 'chats/o1_client-delivery'), { participants: ['cliente1', 'cadete1'], orderId: 'o1' });
  await setDoc(doc(db, 'users/usuarioViejo'), { role: 'user', displayName: 'Cuenta vieja sin clientId' });
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
  assertFails(deleteDoc(doc(cliente1, 'coupons/BIENVENIDA'))));
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
  assertSucceeds(setDoc(doc(cliente1, 'coupons/BIENVENIDA/redemptions/cliente1'), { usedAt: 'hoy' })));
await check('usuario lee un cupon para validarlo',
  assertSucceeds(getDoc(doc(cliente1, 'coupons/BIENVENIDA'))));
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
await check('cadete registra el pago del canon',
  assertSucceeds(setDoc(doc(cadete1, 'delivery_canon_payments/c1'), { driverId: 'cadete1', amount: 5000 })));
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
  assertFails(getDoc(doc(anon, 'coupons/BIENVENIDA'))));

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
await check('comercio entra al chat de su pedido aunque no figure en participants',
  assertSucceeds(getDoc(doc(duenoPizza, 'chats/o1_client-delivery'))));
await check('un vecino ajeno NO entra al chat',
  assertFails(getDoc(doc(cliente2, 'chats/o1_client-delivery'))));
await check('cliente lee los mensajes de su chat',
  assertSucceeds(getDocs(collection(cliente1, 'chats/o1_client-delivery/messages'))));
await check('comercio lee los mensajes del chat de su pedido',
  assertSucceeds(getDocs(collection(duenoPizza, 'chats/o1_client-delivery/messages'))));
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
await check('cadete NO mete campos extra en la ubicacion',
  assertFails(setDoc(doc(cadete1, 'orders/o4/live/driver'), { ...livePos(), status: 'completed' })));
await check('cadete NO escribe otro doc que no sea "driver"',
  assertFails(setDoc(doc(cadete1, 'orders/o4/live/otro'), livePos())));

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
