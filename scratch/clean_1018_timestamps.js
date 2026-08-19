import { initializeApp } from 'firebase/app';
import { getFirestore, collection, query, where, getDocs, doc, updateDoc } from 'firebase/firestore';

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

async function clean1018Timestamps() {
  console.log('=== CLEANING TIMESTAMPS FOR ORDER 1018 ===');

  const q = query(collection(db, 'orders'), where('orderId', '==', 1018));
  const snap = await getDocs(q);

  if (snap.empty) {
    console.error('Order 1018 not found');
    process.exit(1);
  }

  const ref = doc(db, 'orders', snap.docs[0].id);
  await updateDoc(ref, {
    acceptedAt: null,
    confirmedAt: null,
    preparingAt: null,
    readyAt: null,
    pickedUpAt: null,
    deliveredAt: null,
    completedAt: null
  });

  console.log('Successfully cleaned timestamps for order 1018!');
  process.exit(0);
}

clean1018Timestamps().catch(console.error);
