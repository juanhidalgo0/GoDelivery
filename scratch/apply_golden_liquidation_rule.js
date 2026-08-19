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

async function applyGoldenRule() {
  console.log('=== APPLYING GOLDEN LIQUIDATION RULE FOR ALL DRIVERS ===');

  // 1. Get latest liquidation timestamp for each driver
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

  console.log('Drivers last liquidation timestamps:', driverLastLiq);

  // 2. Mark all canons <= lastLiqTime as settled: true
  const canonsSnap = await getDocs(collection(db, 'delivery_canon_payments'));
  let settledCanons = 0;
  for (const cDoc of canonsSnap.docs) {
    const c = cDoc.data();
    const lastLiqTime = driverLastLiq[c.driverId];
    if (c.driverId && lastLiqTime && c.createdAt) {
      const cTime = c.createdAt.toMillis ? c.createdAt.toMillis() : new Date(c.createdAt).getTime();
      if (cTime <= lastLiqTime && c.settled !== true) {
        await updateDoc(doc(db, 'delivery_canon_payments', cDoc.id), {
          settled: true,
          status: 'settled',
          settledAt: c.createdAt
        });
        settledCanons++;
      }
    }
  }
  console.log(`Marked ${settledCanons} canons created <= lastLiqTime as settled: true`);

  // 3. Mark all orders <= lastLiqTime as isSettledDriver: true
  const ordersSnap = await getDocs(collection(db, 'orders'));
  let settledOrders = 0;
  for (const oDoc of ordersSnap.docs) {
    const o = oDoc.data();
    const lastLiqTime = driverLastLiq[o.driverId];
    if (o.driverId && lastLiqTime && o.createdAt) {
      const oTime = o.createdAt.toMillis ? o.createdAt.toMillis() : new Date(o.createdAt).getTime();
      if (oTime <= lastLiqTime && o.isSettledDriver !== true) {
        await updateDoc(doc(db, 'orders', oDoc.id), {
          isSettledDriver: true,
          driverCommissionStatus: 'paid'
        });
        settledOrders++;
      }
    }
  }
  console.log(`Marked ${settledOrders} orders created <= lastLiqTime as isSettledDriver: true`);

  // 4. Update user docs for drivers whose last liquidation cleared their period
  const usersSnap = await getDocs(collection(db, 'users'));
  for (const uDoc of usersSnap.docs) {
    const u = uDoc.data();
    const uid = uDoc.id;
    const lastLiqTime = driverLastLiq[uid];

    if (lastLiqTime && (u.role === 'delivery' || u.isDelivery)) {
      // Find unsettled orders and canons AFTER lastLiqTime
      const postOrders = ordersSnap.docs.filter(d => {
        const o = d.data();
        if (o.driverId !== uid || o.isSettledDriver === true) return false;
        const oTime = o.createdAt?.toMillis ? o.createdAt.toMillis() : new Date(o.createdAt).getTime();
        return oTime > lastLiqTime;
      });

      const postCanons = canonsSnap.docs.filter(d => {
        const c = d.data();
        if (c.driverId !== uid || c.settled === true || c.status === 'revoked') return false;
        const cTime = c.createdAt?.toMillis ? c.createdAt.toMillis() : new Date(c.createdAt).getTime();
        return cTime > lastLiqTime;
      });

      const postAppFees = postOrders.reduce((sum, d) => sum + (d.data().appUsageFee || 0), 0);
      const postCanonFees = postCanons.reduce((sum, d) => sum + (d.data().amount || 1800), 0);
      const newCalculatedDebt = postAppFees + postCanonFees;

      if (u.deliveryDebt !== newCalculatedDebt) {
        console.log(`Updating driver ${uid} (${u.displayName || u.name}) deliveryDebt: ${u.deliveryDebt} -> ${newCalculatedDebt}`);
        await updateDoc(doc(db, 'users', uid), {
          deliveryDebt: newCalculatedDebt
        });
      }
    }
  }

  process.exit(0);
}

applyGoldenRule().catch(console.error);
