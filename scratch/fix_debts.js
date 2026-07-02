import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, updateDoc, writeBatch } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyAldeFtUWWlEpcuEg1LSTko90cVEvnsMLA",
  authDomain: "godelivery-magdalena.firebaseapp.com",
  projectId: "godelivery-magdalena",
  storageBucket: "godelivery-magdalena.firebasestorage.app",
  messagingSenderId: "848164656125",
  appId: "1:848164656125:web:eef2314205f5d8f887ff94",
  measurementId: "G-80XHGQE5RR"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function fixDebts() {
  console.log('Fixing driver debts...');
  
  // Get all completed, unpaid orders
  const ordersSnap = await getDocs(collection(db, 'orders'));
  const driversDebt = {};
  
  ordersSnap.forEach(snap => {
    const data = snap.data();
    if (data.status === 'completed' && data.commissionStatus !== 'paid' && data.driverId) {
      if (!driversDebt[data.driverId]) {
        driversDebt[data.driverId] = 0;
      }
      driversDebt[data.driverId] += (data.appUsageFee || 0);
    }
  });

  const batch = writeBatch(db);
  for (const driverId of Object.keys(driversDebt)) {
    console.log(`Fixing driver ${driverId} debt to ${driversDebt[driverId]}`);
    batch.update(doc(db, 'users', driverId), {
      deliveryDebt: driversDebt[driverId]
    });
  }
  
  await batch.commit();
  console.log('Done!');
}

fixDebts();
