import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, query, where } from 'firebase/firestore';

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

async function inspectAgustinRecords() {
  const uid = '3gJwz5RSPiTvxjxGYSsHlj1pMLu1';
  console.log('=== INSPECTING AGUSTIN YACACHURY (3gJwz5RSPiTvxjxGYSsHlj1pMLu1) ===');

  console.log('\n--- LIQUIDATIONS (delivery_debt_settlements) ---');
  const qLiq1 = query(collection(db, 'delivery_debt_settlements'), where('driverId', '==', uid));
  const snapLiq1 = await getDocs(qLiq1);
  snapLiq1.docs.forEach(d => {
    const data = d.data();
    const dateStr = data.createdAt ? (data.createdAt.toDate ? data.createdAt.toDate().toLocaleString('es-AR') : new Date(data.createdAt).toLocaleString('es-AR')) : 'No date';
    console.log(d.id, '$' + data.amount, 'Date:', dateStr, data.notes || '');
  });

  console.log('\n--- LIQUIDATION TRANSACTIONS (delivery_transactions) ---');
  const qTrans = query(collection(db, 'delivery_transactions'), where('driverId', '==', uid));
  const snapTrans = await getDocs(qTrans);
  snapTrans.docs.forEach(d => {
    const data = d.data();
    const dateStr = data.createdAt ? (data.createdAt.toDate ? data.createdAt.toDate().toLocaleString('es-AR') : new Date(data.createdAt).toLocaleString('es-AR')) : 'No date';
    console.log(d.id, data.type, '$' + data.amount, data.description, 'Date:', dateStr);
  });

  console.log('\n--- CANON PAYMENTS (delivery_canon_payments) ---');
  const qCanons = query(collection(db, 'delivery_canon_payments'), where('driverId', '==', uid));
  const snapCanons = await getDocs(qCanons);
  snapCanons.docs.forEach(d => {
    const data = d.data();
    const dateStr = data.createdAt ? (data.createdAt.toDate ? data.createdAt.toDate().toLocaleString('es-AR') : new Date(data.createdAt).toLocaleString('es-AR')) : 'No date';
    console.log(d.id, data.dateStr, '$' + data.amount, 'Settled:', data.settled, 'Status:', data.status, 'Date:', dateStr);
  });

  process.exit(0);
}

inspectAgustinRecords().catch(console.error);
