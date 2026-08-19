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

async function checkCanons() {
  console.log('=== CHECKING DELIVERY CANON PAYMENTS ===');
  const snap1 = await getDocs(collection(db, 'delivery_canon_payments'));
  console.log('delivery_canon_payments docs count:', snap1.size);
  snap1.docs.forEach(d => console.log('Canon Payment:', d.id, d.data()));

  console.log('\n=== CHECKING DELIVERY TRANSACTIONS (CANON CHARGES) ===');
  const q2 = query(collection(db, 'delivery_transactions'), where('type', '==', 'canon_charge'));
  const snap2 = await getDocs(q2);
  console.log('canon_charge transactions count:', snap2.size);
  snap2.docs.forEach(d => console.log('Canon Transaction:', d.id, d.data()));

  process.exit(0);
}

checkCanons().catch(console.error);
