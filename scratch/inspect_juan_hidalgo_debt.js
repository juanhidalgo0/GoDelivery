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

async function inspectJuanHidalgo() {
  console.log('=== SEARCHING FOR JUAN HIDALGO ===');
  const usersSnap = await getDocs(collection(db, 'users'));
  const juanUser = usersSnap.docs.find(d => {
    const data = d.data();
    return (data.name || data.displayName || '').toLowerCase().includes('juan hidalgo') || (data.phone || '').includes('2215365249');
  });

  if (!juanUser) {
    console.error('Juan Hidalgo not found in users');
    process.exit(1);
  }

  console.log('Juan Hidalgo UID:', juanUser.id, juanUser.data());

  const qTrans = query(collection(db, 'delivery_transactions'), where('driverId', '==', juanUser.id));
  const transSnap = await getDocs(qTrans);
  console.log('\n=== JUAN HIDALGO TRANSACTIONS ===');
  transSnap.docs.forEach(d => {
    const t = d.data();
    const dateStr = t.createdAt ? (t.createdAt.toDate ? t.createdAt.toDate().toLocaleString('es-AR') : new Date(t.createdAt).toLocaleString('es-AR')) : 'No date';
    console.log(d.id, t.type, t.description, '$' + t.amount, 'Date:', dateStr);
  });

  const qCanon = query(collection(db, 'delivery_canon_payments'), where('driverId', '==', juanUser.id));
  const canonSnap = await getDocs(qCanon);
  console.log('\n=== JUAN HIDALGO CANON PAYMENTS ===');
  canonSnap.docs.forEach(d => {
    const c = d.data();
    const dateStr = c.createdAt ? (c.createdAt.toDate ? c.createdAt.toDate().toLocaleString('es-AR') : new Date(c.createdAt).toLocaleString('es-AR')) : 'No date';
    console.log(d.id, c.dateStr, '$' + c.amount, 'Settled:', c.settled, 'Date:', dateStr);
  });

  process.exit(0);
}

inspectJuanHidalgo().catch(console.error);
