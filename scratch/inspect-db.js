import { initializeApp } from 'firebase/app';
import { initializeFirestore, collection, getDocs } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyAldeFtUWWlEpcuEg1LSTko90cVEvnsMLA",
  authDomain: "godelivery-magdalena.firebaseapp.com",
  projectId: "godelivery-magdalena",
  storageBucket: "godelivery-magdalena.firebasestorage.app",
  messagingSenderId: "848164656125",
  appId: "1:848164656125:web:eef2314205f5d8f887ff94",
  measurementId: "G-80XHGQE5RR"
};

const app = initializeApp(firebaseConfig);
const db = initializeFirestore(app, {});

async function run() {
  console.log('--- COMERCIOS ---');
  const comerciosSnap = await getDocs(collection(db, 'comercios'));
  comerciosSnap.forEach(doc => {
    console.log(`ID: ${doc.id} | Name: ${doc.data().name} | OwnerId: ${doc.data().ownerId} | PIN: ${doc.data().pin}`);
  });

  console.log('\n--- USERS ---');
  const usersSnap = await getDocs(collection(db, 'users'));
  usersSnap.forEach(doc => {
    console.log(`ID: ${doc.id} | Email: ${doc.data().email} | Role: ${doc.data().role} | Name: ${doc.data().displayName}`);
  });

  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
