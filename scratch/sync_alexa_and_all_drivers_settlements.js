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

async function syncAllDrivers() {
  console.log('=== SYNCING SETTLEMENTS & CANONS FOR ALL DRIVERS ===');

  // 1. Fetch settlements for all drivers
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

  console.log('Last liquidation timestamps:', driverLastLiq);

  // 2. For each driver, sync orders created before lastLiqTime to isSettledDriver: true
  const ordersSnap = await getDocs(collection(db, 'orders'));
  let settledOrdersCount = 0;

  for (const oDoc of ordersSnap.docs) {
    const o = oDoc.data();
    const driverId = o.driverId;
    const lastLiqTime = driverLastLiq[driverId];

    if (driverId && lastLiqTime && o.createdAt) {
      const orderTime = o.createdAt.toMillis ? o.createdAt.toMillis() : new Date(o.createdAt).getTime();
      if (orderTime <= lastLiqTime && o.isSettledDriver !== true) {
        await updateDoc(doc(db, 'orders', oDoc.id), {
          isSettledDriver: true,
          driverCommissionStatus: 'paid'
        });
        settledOrdersCount++;
      }
    }
  }
  console.log(`Updated ${settledOrdersCount} past orders to isSettledDriver: true`);

  // 3. For Alexa (and any driver whose canons created AFTER lastLiqTime were mistakenly marked settled: true):
  const canonsSnap = await getDocs(collection(db, 'delivery_canon_payments'));
  let resetCanonsCount = 0;

  for (const cDoc of canonsSnap.docs) {
    const c = cDoc.data();
    const driverId = c.driverId;
    const lastLiqTime = driverLastLiq[driverId];

    if (driverId && lastLiqTime && c.createdAt) {
      const canonTime = c.createdAt.toMillis ? c.createdAt.toMillis() : new Date(c.createdAt).getTime();
      // If canon was created AFTER the last settlement timestamp, it belongs to the CURRENT unpaid period!
      if (canonTime > lastLiqTime && c.settled === true) {
        await updateDoc(doc(db, 'delivery_canon_payments', cDoc.id), {
          settled: false,
          status: 'active'
        });
        resetCanonsCount++;
        console.log(`Reset canon ${cDoc.id} for driver ${driverId} (date ${c.dateStr}) to settled: false`);
      }
    }
  }
  console.log(`Reset ${resetCanonsCount} post-settlement canons to settled: false`);

  process.exit(0);
}

syncAllDrivers().catch(console.error);
