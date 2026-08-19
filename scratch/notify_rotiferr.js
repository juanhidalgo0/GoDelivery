import { initializeApp } from 'firebase/app';
import { getFirestore, collection, doc, getDoc, getDocs, query, where, addDoc, serverTimestamp } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyDFaOVxf6QfK03rRTVfIH84HLc5Qujzrew",
  authDomain: "godelivery-magdalena.firebaseapp.com",
  projectId: "godelivery-magdalena",
  storageBucket: "godelivery-magdalena.firebasestorage.app",
  messagingSenderId: "848164656125",
  appId: "1:848164656125:web:86b4a5df1ab82cae7eb886"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function notifyRotiferr() {
  console.log('=== CHECKING AND NOTIFYING ROTIFERR FOR ORDER 1018 ===');

  // 1. Find Rotiferr commerce
  const comerciosSnap = await getDocs(collection(db, 'comercios'));
  const rotiferrComercio = comerciosSnap.docs.find(d => {
    const data = d.data();
    return (data.name || '').toLowerCase().includes('rotiferr') || d.id === 'Pq4VPt63A5Z4zSMApoxwAf2Thvu1';
  });

  if (!rotiferrComercio) {
    console.error('Rotiferr commerce doc not found');
    process.exit(1);
  }

  const comercioData = rotiferrComercio.data();
  console.log('Rotiferr Comercio Data:', rotiferrComercio.id, comercioData);

  const ownerId = comercioData.ownerId || comercioData.uid || 'Pq4VPt63A5Z4zSMApoxwAf2Thvu1';
  console.log('Rotiferr Owner ID:', ownerId);

  // 2. Fetch Owner user details & FCM tokens
  const ownerDoc = await getDoc(doc(db, 'users', ownerId));
  if (ownerDoc.exists()) {
    console.log('Owner User Data:', ownerDoc.data());
  }

  const tokensSnap = await getDocs(collection(db, 'users', ownerId, 'fcmTokens'));
  console.log('Owner FCM Tokens count:', tokensSnap.size);
  tokensSnap.docs.forEach(t => console.log('FCM Token:', t.id, t.data()));

  // 3. Create Notification in Firestore for Rotiferr Panel
  const notifRef = await addDoc(collection(db, 'notifications'), {
    userId: ownerId,
    comercioId: rotiferrComercio.id,
    title: '🔔 ¡NUEVO PEDIDO PENDIENTE #1018!',
    body: 'Pedido Yanella Torancio - Pizza de Muzza, Pizza Especial ($18.665)',
    type: 'new_order',
    orderId: 'cbdzU98xGB7IBedmxSbx',
    displayId: 1018,
    read: false,
    createdAt: serverTimestamp()
  });

  console.log('Created Firestore Notification document:', notifRef.id);

  // 4. Create Notification inside user subcollection if applicable
  const userNotifRef = await addDoc(collection(db, 'users', ownerId, 'notifications'), {
    title: '🔔 ¡NUEVO PEDIDO PENDIENTE #1018!',
    body: 'Pedido Yanella Torancio - Pizza de Muzza, Pizza Especial ($18.665)',
    type: 'new_order',
    orderId: 'cbdzU98xGB7IBedmxSbx',
    displayId: 1018,
    read: false,
    createdAt: serverTimestamp()
  });

  console.log('Created User Notification document:', userNotifRef.id);

  process.exit(0);
}

notifyRotiferr().catch(console.error);
