import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, query, where, updateDoc, doc } from 'firebase/firestore';

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

async function cleanupPastCanons() {
  console.log('=== CLEANING UP PAST SETTLED CANONS FOR ALL DRIVERS ===');

  // 1. Fetch all settlements
  const liqSnap = await getDocs(collection(db, 'delivery_debt_settlements'));
  const driverLastLiq = {};

  liqSnap.docs.forEach(d => {
    const data = d.data();
    if (data.driverId && data.createdAt) {
      const ts = data.createdAt.toMillis ? data.createdAt.toMillis() : new Date(data.createdAt).getTime();
      if (!driverLastLiq[data.driverId] || ts > driverLastLiq[data.driverId]) {
        driverLastLiq[data.driverId] = ts;
      }
    }
  });

  // Also check delivery_transactions for liquidation types
  const transSnap = await getDocs(query(collection(db, 'delivery_transactions'), where('type', '==', 'liquidation')));
  transSnap.docs.forEach(d => {
    const data = d.data();
    if (data.driverId && data.createdAt) {
      const ts = data.createdAt.toMillis ? data.createdAt.toMillis() : new Date(data.createdAt).getTime();
      if (!driverLastLiq[data.driverId] || ts > driverLastLiq[data.driverId]) {
        driverLastLiq[data.driverId] = ts;
      }
    }
  });

  console.log('Found last liquidation timestamps for drivers:', driverLastLiq);

  // 2. Fetch all canon payments
  const canonSnap = await getDocs(collection(db, 'delivery_canon_payments'));
  let updatedCount = 0;

  for (const cDoc of canonSnap.docs) {
    const data = cDoc.data();
    const driverId = data.driverId;
    const lastLiqTime = driverLastLiq[driverId];

    if (driverId && lastLiqTime && data.createdAt) {
      const canonTime = data.createdAt.toMillis ? data.createdAt.toMillis() : new Date(data.createdAt).getTime();
      if (canonTime <= lastLiqTime && data.settled !== true) {
        await updateDoc(doc(db, 'delivery_canon_payments', cDoc.id), {
          settled: true,
          status: 'settled',
          settledAt: data.createdAt
        });
        updatedCount++;
        console.log(`Updated past canon doc ${cDoc.id} (driver ${driverId}, date ${data.dateStr}) to settled: true`);
      }
    }
  }

  console.log(`Successfully updated ${updatedCount} past canon payment docs to settled: true!`);
  process.exit(0);
}

cleanupPastCanons().catch(console.error);
