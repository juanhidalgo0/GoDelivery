import { initializeApp } from 'firebase/app';
import { initializeFirestore } from 'firebase/firestore';
import { collection, getDocs } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyAldeFtUWWlEpcuEg1LSTko90cVEvnsMLA",
  authDomain: "godelivery-magdalena.firebaseapp.com",
  projectId: "godelivery-magdalena",
  storageBucket: "godelivery-magdalena.firebasestorage.app",
  messagingSenderId: "848164656125",
  appId: "1:848164656125:web:eef2314205f5d8f887ff94"
};

const app = initializeApp(firebaseConfig);
const db = initializeFirestore(app, {});

console.log('Fetching comercios...');
const snap = await getDocs(collection(db, 'comercios'));
snap.forEach(doc => {
  console.log(doc.id, '-> Name:', doc.data().name, '\nLogo:', doc.data().logo ? doc.data().logo.substring(0, 150) : 'no logo', '\n');
});
process.exit(0);
