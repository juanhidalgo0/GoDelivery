import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, query, where, doc, getDoc } from 'firebase/firestore';

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

async function inspectAlexaDeep() {
  const uid = 'ULzAOXwm3JcH3SOQLBzPbuDwSf62'; // Alexa
  console.log('=== DEEP INSPECTION FOR ALEXA (ULzAOXwm3JcH3SOQLBzPbuDwSf62) ===');

  const uSnap = await getDoc(doc(db, 'users', uid));
  const uData = uSnap.data();
  console.log('User Document:', {
    displayName: uData.displayName || uData.name,
    deliveryDebt: uData.deliveryDebt,
    isCanonExempt: uData.isCanonExempt,
    lastCanonDate: uData.lastCanonDate,
    lastCanonChargeDate: uData.lastCanonChargeDate,
    lastLiquidationAt: uData.lastLiquidationAt ? (uData.lastLiquidationAt.toDate ? uData.lastLiquidationAt.toDate().toISOString() : uData.lastLiquidationAt) : null
  });

  console.log('\n--- SETTLEMENTS (delivery_debt_settlements) ---');
  const qLiq = query(collection(db, 'delivery_debt_settlements'), where('driverId', '==', uid));
  const snapLiq = await getDocs(qLiq);
  console.log('Total settlements count:', snapLiq.size);
  let lastLiqTime = 0;
  snapLiq.docs.forEach(d => {
    const data = d.data();
    const ts = data.createdAt?.toMillis ? data.createdAt.toMillis() : (data.createdAt ? new Date(data.createdAt).getTime() : 0);
    if (ts > lastLiqTime) lastLiqTime = ts;
    const dateStr = data.createdAt ? (data.createdAt.toDate ? data.createdAt.toDate().toISOString() : data.createdAt) : 'No date';
    console.log(d.id, '$' + data.amount, 'Date:', dateStr, data.notes || '');
  });
  console.log('Last Liquidation Timestamp:', lastLiqTime, lastLiqTime > 0 ? new Date(lastLiqTime).toISOString() : 'None');

  console.log('\n--- CANON PAYMENTS (delivery_canon_payments) ---');
  const qCanons = query(collection(db, 'delivery_canon_payments'), where('driverId', '==', uid));
  const snapCanons = await getDocs(qCanons);
  console.log('Total canon docs count:', snapCanons.size);
  snapCanons.docs.forEach(d => {
    const c = d.data();
    const cTime = c.createdAt?.toMillis ? c.createdAt.toMillis() : (c.createdAt ? new Date(c.createdAt).getTime() : 0);
    const isAfterLastLiq = lastLiqTime > 0 ? cTime > lastLiqTime : true;
    console.log(d.id, c.dateStr, '$' + c.amount, 'settled:', c.settled, 'status:', c.status, 'createdAt:', c.createdAt?.toDate ? c.createdAt.toDate().toISOString() : c.createdAt, 'isAfterLastLiq:', isAfterLastLiq);
  });

  console.log('\n--- UNSETTLED ORDERS ---');
  const qO = query(collection(db, 'orders'), where('driverId', '==', uid));
  const snapO = await getDocs(qO);
  snapO.docs.forEach(d => {
    const o = d.data();
    if (o.isSettledDriver !== true) {
      console.log('Unsettled Order:', d.id, 'status:', o.status, 'appUsageFee:', o.appUsageFee, 'createdAt:', o.createdAt?.toDate ? o.createdAt.toDate().toISOString() : o.createdAt);
    }
  });

  process.exit(0);
}

inspectAlexaDeep().catch(console.error);
