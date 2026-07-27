import admin from 'firebase-admin';

process.env.FIRESTORE_EMULATOR_HOST = '';
admin.initializeApp({ projectId: "godelivery-magdalena" });
const db = admin.firestore();

async function checkDriver() {
  const email = 'daissangrone18@gmail.com';
  console.log(`\n=== Diagnosticando repartidor: ${email} ===\n`);

  const snap = await db.collection('users').where('email', '==', email).get();
  if (snap.empty) {
    console.log('❌ USUARIO NO ENCONTRADO en Firestore');
    return;
  }

  const d = snap.docs[0];
  const u = d.data();
  const uid = d.id;

  console.log('📋 DATOS DEL USUARIO');
  console.log('  ID:', uid);
  console.log('  role:', u.role || '⚠️ SIN ROL');
  console.log('  isOnline:', u.isOnline);
  console.log('  isActive:', u.isActive);
  console.log('  missedOffersCount:', u.missedOffersCount ?? 0);
  console.log('  cooldownUntil:', u.cooldownUntil?.toDate?.() || u.cooldownUntil || 'ninguno');
  console.log('  deliveryMode:', u.deliveryMode || 'both (default)');
  console.log('  deliveryId:', u.deliveryId || '⚠️ SIN deliveryId');
  console.log('  currentSessionId:', u.currentSessionId || 'ninguno');
  console.log('  lastActivityAt:', u.lastActivityAt?.toDate?.() || u.lastActivityAt || 'nunca');
  console.log('  autoAcceptEnabled:', u.autoAcceptEnabled);

  // FCM Tokens
  const tokensSnap = await db.collection('users').doc(uid).collection('fcmTokens').get();
  console.log('\n📲 TOKENS FCM');
  if (tokensSnap.empty) {
    console.log('  ❌ SIN tokens FCM registrados — no recibirá push notifications');
  } else {
    tokensSnap.docs.forEach(t => {
      const td = t.data();
      console.log(`  ✅ Token: ${t.id.substring(0,20)}... | Platform: ${td.platform} | Updated: ${td.updatedAt?.toDate?.()}`);
    });
  }

  // Ordenes activas asignadas a este driver
  const activeOrders = await db.collection('orders')
    .where('driverId', '==', uid)
    .where('status', 'in', ['accepted', 'preparing', 'ready', 'picked_up', 'at_door'])
    .get();
  console.log('\n📦 PEDIDOS ACTIVOS ASIGNADOS:', activeOrders.size);
  activeOrders.docs.forEach(o => {
    const od = o.data();
    console.log(`  - Orden ${o.id}: status=${od.status}, comercio=${od.comercioName}`);
  });

  // Pedidos en cola ofrecidos a este driver ahora mismo
  const queuedForDriver = await db.collection('orders')
    .where('queueTargetDriverId', '==', uid)
    .where('status', 'in', ['ready', 'preparing'])
    .get();
  console.log('\n⏳ PEDIDOS EN COLA OFRECIDOS AHORA:', queuedForDriver.size);

  // Diagnóstico
  console.log('\n🔍 DIAGNÓSTICO:');
  if (u.role !== 'delivery') console.log('  ❌ role no es "delivery" → no entra en el pool de repartidores');
  if (!u.isOnline) console.log('  ❌ isOnline=false → no está conectado, no recibe pedidos');
  if (u.isActive === false) console.log('  ❌ isActive=false → cuenta desactivada');
  if ((u.missedOffersCount || 0) >= 2) console.log('  ❌ missedOffersCount >= 2 → fue desconectado por inactividad');
  if (u.cooldownUntil) {
    const cooldownMs = u.cooldownUntil?.toMillis?.() || new Date(u.cooldownUntil).getTime();
    if (cooldownMs > Date.now()) console.log('  ❌ cooldownUntil activo hasta:', new Date(cooldownMs));
  }
  if (tokensSnap.empty) console.log('  ⚠️ Sin FCM tokens → llegan a la cola pero NO recibe push notifications');
  if (!u.deliveryId) console.log('  ⚠️ Sin deliveryId asignado');
  if (u.role === 'delivery' && u.isOnline && !u.cooldownUntil && (u.missedOffersCount || 0) < 2) {
    console.log('  ✅ El usuario parece estar correctamente configurado para recibir pedidos');
    console.log('     → El problema puede ser que no hay pedidos disponibles en su zona, o que los pedidos van a otros repartidores primero (round-robin)');
  }
}

checkDriver().catch(console.error).finally(() => process.exit(0));
