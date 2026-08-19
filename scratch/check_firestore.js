import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';

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

async function checkSettings() {
  const snap = await getDoc(doc(db, 'settings', 'global'));
  if (snap.exists()) {
    console.log('settings/global:', snap.data());
  } else {
    console.log('settings/global does not exist');
  }
  process.exit(0);
}

checkSettings().catch(console.error);
