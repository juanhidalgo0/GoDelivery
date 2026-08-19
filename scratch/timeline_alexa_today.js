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

async function checkTimeline() {
  const uid = 'ULzAOXwm3JcH3SOQLBzPbuDwSf62'; // Alexa
  console.log('=== EXACT TIMELINE FOR ALEXA TODAY (17/08/2026) ===');

  // 1. Canon 17/08 creation time
  const canonSnap = await getDoc(doc(db, 'delivery_canon_payments', `${uid}_2026-08-17`));
  if (canonSnap.exists()) {
    const cData = canonSnap.data();
    const cDate = cData.createdAt?.toDate ? cData.createdAt.toDate().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' }) : cData.createdAt;
    console.log('1. CANON 17/08 CREATED AT:', cDate, 'ISO:', cData.createdAt?.toDate ? cData.createdAt.toDate().toISOString() : cData.createdAt);
  }

  // 2. Settlement proof approval time
  const qLiq = query(collection(db, 'delivery_debt_settlements'), where('driverId', '==', uid));
  const liqSnap = await getDocs(qLiq);
  liqSnap.docs.forEach(d => {
    const data = d.data();
    const lDate = data.createdAt?.toDate ? data.createdAt.toDate().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' }) : data.createdAt;
    console.log('2. SETTLEMENT APPROVED AT:', lDate, 'Amount:', '$' + data.amount, 'ID:', d.id);
  });

  // 3. Orders completed today
  const qOrders = query(collection(db, 'orders'), where('driverId', '==', uid));
  const ordersSnap = await getDocs(qOrders);
  console.log('\n3. ORDERS COMPLETED TODAY:');
  ordersSnap.docs.forEach(d => {
    const o = d.data();
    const oDate = o.createdAt?.toDate ? o.createdAt.toDate().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' }) : o.createdAt;
    if (oDate.includes('17/8') || oDate.includes('17/08') || (o.createdAt?.toDate && o.createdAt.toDate().toISOString().includes('2026-08-17'))) {
      console.log('Order:', d.id, 'appUsageFee:', o.appUsageFee, 'Date:', oDate, 'ISO:', o.createdAt?.toDate ? o.createdAt.toDate().toISOString() : o.createdAt);
    }
  });

  process.exit(0);
}

checkTimeline().catch(console.error);
