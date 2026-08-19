import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, query, where, orderBy, limit } from 'firebase/firestore';

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

async function inspectAgustin() {
  console.log('=== SEARCHING FOR AGUSTIN YACACHURY ===');
  const usersSnap = await getDocs(collection(db, 'users'));
  const agustinUser = usersSnap.docs.find(d => {
    const data = d.data();
    return (data.name || data.displayName || '').toLowerCase().includes('yacachury');
  });

  if (!agustinUser) {
    console.error('Agustín Yacachury not found');
    process.exit(1);
  }

  const uid = agustinUser.id;
  console.log('Agustín UID:', uid, agustinUser.data());

  console.log('\n=== LAST LIQUIDATION FOR AGUSTIN ===');
  const qLiq = query(collection(db, 'delivery_debt_settlements'), where('driverId', '==', uid));
  const liqSnap = await getDocs(qLiq);
  console.log('Settlements count:', liqSnap.size);
  liqSnap.docs.forEach(d => {
    const data = d.data();
    const dateStr = data.createdAt ? (data.createdAt.toDate ? data.createdAt.toDate().toLocaleString('es-AR') : new Date(data.createdAt).toLocaleString('es-AR')) : 'No date';
    console.log('Settlement:', d.id, '$' + data.amount, 'Date:', dateStr);
  });

  console.log('\n=== CANON PAYMENTS FOR AGUSTIN ===');
  const qCanons = query(collection(db, 'delivery_canon_payments'), where('driverId', '==', uid));
  const canonSnap = await getDocs(qCanons);
  console.log('Canon Payments count:', canonSnap.size);
  canonSnap.docs.forEach(d => {
    const c = d.data();
    const dateStr = c.createdAt ? (c.createdAt.toDate ? c.createdAt.toDate().toLocaleString('es-AR') : new Date(c.createdAt).toLocaleString('es-AR')) : 'No date';
    console.log(d.id, c.dateStr, '$' + c.amount, 'Settled:', c.settled, 'Date:', dateStr);
  });

  process.exit(0);
}

inspectAgustin().catch(console.error);
