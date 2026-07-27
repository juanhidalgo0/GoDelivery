import { initializeApp } from 'firebase/app';
import { initializeFirestore } from 'firebase/firestore';
import { collection, getDocs, query, where } from 'firebase/firestore';

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

async function run() {
  console.log('Fetching user kioscopaulos7@gmail.com...');
  const q = query(collection(db, 'users'), where('email', '==', 'kioscopaulos7@gmail.com'));
  const snap = await getDocs(q);
  snap.forEach(doc => {
    const data = doc.data();
    console.log(`User ID: ${doc.id}`);
    console.log(`Email: ${data.email}`);
    console.log(`DisplayName: ${data.displayName}`);
    console.log(`role: ${data.role}`);
    console.log(`isDelivery: ${data.isDelivery}`);
    console.log(`isOnline: ${data.isOnline}`);
    console.log('--------------------');
  });
}

run().then(() => process.exit(0)).catch(console.error);
