import { initializeApp } from 'firebase/app';
import { getFirestore, collection, query, where, getDocs, doc, updateDoc } from 'firebase/firestore';

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

async function fixOrder1018() {
  console.log('=== FIXING ORDER 1018 IN FIRESTORE ===');
  
  const q = query(collection(db, 'orders'), where('displayId', '==', 1018));
  let snap = await getDocs(q);
  
  if (snap.empty) {
    const qStr = query(collection(db, 'orders'), where('displayId', '==', '1018'));
    snap = await getDocs(qStr);
  }

  if (snap.empty) {
    const allSnap = await getDocs(collection(db, 'orders'));
    const docMatch = allSnap.docs.find(d => {
      const data = d.data();
      return String(data.displayId || data.orderId || d.id).includes('1018');
    });
    if (docMatch) snap = { docs: [docMatch], empty: false };
  }

  if (snap.empty) {
    console.error('Order 1018 not found');
    process.exit(1);
  }

  const orderDoc = snap.docs[0];
  console.log('Found order 1018:', orderDoc.id, orderDoc.data());

  const ref = doc(db, 'orders', orderDoc.id);
  await updateDoc(ref, {
    driverId: null,
    driverName: null,
    driverPhone: null,
    driver: null,
    queueTargetDriverId: null,
    queueTargetDriverName: null,
    queueOfferedAt: null,
    queueOfferedDrivers: [],
    queueRejectedDrivers: [],
    manuallyRejectedDrivers: []
  });

  console.log('Successfully unassigned driver from order 1018!');
  process.exit(0);
}

fixOrder1018().catch(console.error);
