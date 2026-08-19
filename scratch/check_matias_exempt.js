import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc } from 'firebase/firestore';

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

async function checkMatias() {
  const uSnap = await getDoc(doc(db, 'users', 'hG531uadidgaVcd75uVSnhu8QD73'));
  const d = uSnap.data();
  console.log('Matías Gómez user doc:', {
    displayName: d.displayName,
    deliveryDebt: d.deliveryDebt,
    isCanonExempt: d.isCanonExempt,
    lastCanonDate: d.lastCanonDate,
    lastCanonChargeDate: d.lastCanonChargeDate,
    points: d.points
  });
  process.exit(0);
}

checkMatias().catch(console.error);
