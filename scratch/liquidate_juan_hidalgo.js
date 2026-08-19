import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, query, where, doc, updateDoc } from 'firebase/firestore';

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

async function liquidateJuanHidalgo() {
  console.log('=== LIQUIDATING JUAN HIDALGO IN FIRESTORE ===');
  const uid = 'Ev2OLaqIrETTEKKWV3R1TOF6TzG3';

  // 1. Reset deliveryDebt to 0
  await updateDoc(doc(db, 'users', uid), {
    deliveryDebt: 0
  });
  console.log('Updated users/Ev2OLaqIrETTEKKWV3R1TOF6TzG3 deliveryDebt = 0');

  // 2. Mark all delivery_canon_payments as settled: true
  const qCanons = query(collection(db, 'delivery_canon_payments'), where('driverId', '==', uid));
  const canonSnap = await getDocs(qCanons);
  for (const d of canonSnap.docs) {
    await updateDoc(doc(db, 'delivery_canon_payments', d.id), {
      settled: true,
      status: 'settled'
    });
  }
  console.log(`Marked ${canonSnap.size} canon payment docs as settled: true`);

  // 3. Mark all orders as isSettledDriver: true
  const qOrders = query(collection(db, 'orders'), where('driverId', '==', uid));
  const orderSnap = await getDocs(qOrders);
  for (const d of orderSnap.docs) {
    await updateDoc(doc(db, 'orders', d.id), {
      isSettledDriver: true,
      driverCommissionStatus: 'paid'
    });
  }
  console.log(`Marked ${orderSnap.size} order docs as isSettledDriver: true`);

  process.exit(0);
}

liquidateJuanHidalgo().catch(console.error);
