import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, collection, getDocs, query, where } from 'firebase/firestore';

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

async function debugJuanNow() {
  const uid = 'Ev2OLaqIrETTEKKWV3R1TOF6TzG3';
  console.log('=== DEBUGGING JUAN HIDALGO CURRENT STATE ===');

  const uSnap = await getDoc(doc(db, 'users', uid));
  console.log('User doc deliveryDebt:', uSnap.data().deliveryDebt);

  console.log('\n--- CANON PAYMENTS ---');
  const qCanons = query(collection(db, 'delivery_canon_payments'), where('driverId', '==', uid));
  const snapCanons = await getDocs(qCanons);
  snapCanons.docs.forEach(d => {
    const data = d.data();
    console.log(d.id, data.dateStr, '$' + data.amount, 'Settled:', data.settled, 'Status:', data.status, 'createdAt:', data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : data.createdAt);
  });

  console.log('\n--- UNSETTLED ORDERS ---');
  const qOrders = query(collection(db, 'orders'), where('driverId', '==', uid));
  const snapOrders = await getDocs(qOrders);
  let unsettledOrdersCount = 0;
  snapOrders.docs.forEach(d => {
    const data = d.data();
    if (data.isSettledDriver !== true) {
      unsettledOrdersCount++;
      console.log('Unsettled Order:', d.id, 'Status:', data.status, 'appUsageFee:', data.appUsageFee, 'couponDiscount:', data.couponDiscount, 'createdAt:', data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : data.createdAt);
    }
  });
  console.log('Total unsettled orders:', unsettledOrdersCount);

  console.log('\n--- SETTLEMENTS ---');
  const qLiq = query(collection(db, 'delivery_debt_settlements'), where('driverId', '==', uid));
  const snapLiq = await getDocs(qLiq);
  snapLiq.docs.forEach(d => console.log('Settlement:', d.id, d.data()));

  process.exit(0);
}

debugJuanNow().catch(console.error);
