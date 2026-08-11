import { initializeApp } from 'firebase/app';
import { initializeFirestore, collection, getDocs, query, where } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyAldeFtUWWlEpcuEg1LSTko90cVEvnsMLA",
  authDomain: "godelivery-magdalena.firebaseapp.com",
  projectId: "godelivery-magdalena",
  storageBucket: "godelivery-magdalena.firebasestorage.app",
  messagingSenderId: "848164656125",
  appId: "1:848164656125:web:eef2314205f5d8f887ff94"
};

const app = initializeApp(firebaseConfig);
const db = initializeFirestore(app, {});

async function run() {
  console.log("Fetching all orders...");
  const ordersSnap = await getDocs(collection(db, 'orders'));
  const allOrders = ordersSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  console.log("Fetching all users...");
  const usersSnap = await getDocs(collection(db, 'users'));
  const drivers = [];
  usersSnap.docs.forEach(docDoc => {
    const data = docDoc.data();
    if (data.isDelivery === true || data.role === 'delivery' || data.deliveryDebt !== undefined) {
      drivers.push({
        id: docDoc.id,
        displayName: data.displayName || data.name || `Driver (${docDoc.id})`,
        deliveryDebt: data.deliveryDebt || 0
      });
    }
  });

  console.log(`\n=== PENDING ORDERS APP FEES PER DRIVER ===`);
  drivers.forEach(d => {
    const driverOrders = allOrders.filter(o => 
      o.driverId === d.id && 
      o.isSettledDriver !== true && 
      (o.status === 'delivered' || o.status === 'completed')
    );

    const appFeesTotal = driverOrders.reduce((sum, o) => sum + (o.appUsageFee || 0), 0);
    const totalCouponsCredit = driverOrders.reduce((sum, o) => sum + (o.couponDiscount || 0), 0);

    if (appFeesTotal > 0 || totalCouponsCredit > 0 || d.deliveryDebt > 0) {
      console.log(`Driver: ${d.displayName} (${d.id})`);
      console.log(`  Firestore deliveryDebt: $${d.deliveryDebt}`);
      console.log(`  Pending Orders Count: ${driverOrders.length}`);
      console.log(`  Pending App Fees: $${appFeesTotal}`);
      console.log(`  Pending Coupons Credit: $${totalCouponsCredit}`);
      console.log(`  Difference (Debt - AppFees + Coupons): $${d.deliveryDebt - appFeesTotal + totalCouponsCredit}`);
    }
  });

  process.exit(0);
}

run().catch(console.error);
