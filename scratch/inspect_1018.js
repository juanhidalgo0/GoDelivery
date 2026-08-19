import { initializeApp } from 'firebase/app';
import { getFirestore, collection, query, where, getDocs } from 'firebase/firestore';

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

async function inspect1018() {
  console.log('=== INSPECTING ORDER 1018 ===');
  
  const q = query(collection(db, 'orders'), where('orderId', '==', 1018));
  let snap = await getDocs(q);

  if (snap.empty) {
    console.error('Order 1018 not found');
    process.exit(1);
  }

  const data = snap.docs[0].data();
  console.log('Order 1018 full data:', data);
  console.log('status:', data.status);
  console.log('acceptedAt:', data.acceptedAt);
  console.log('confirmedAt:', data.confirmedAt);
  console.log('preparingAt:', data.preparingAt);
  console.log('readyAt:', data.readyAt);
  console.log('createdAt:', data.createdAt);

  process.exit(0);
}

inspect1018().catch(console.error);
