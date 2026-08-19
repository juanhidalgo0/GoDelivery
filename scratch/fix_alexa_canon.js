import { initializeApp } from 'firebase/app';
import { getFirestore, doc, updateDoc } from 'firebase/firestore';

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

async function fixAlexaCanon() {
  const docId = 'ULzAOXwm3JcH3SOQLBzPbuDwSf62_2026-08-17';
  console.log('Resetting Alexa 17/08 canon to settled: false');
  await updateDoc(doc(db, 'delivery_canon_payments', docId), {
    settled: false,
    status: 'active'
  });
  console.log('Done!');
  process.exit(0);
}

fixAlexaCanon().catch(console.error);
