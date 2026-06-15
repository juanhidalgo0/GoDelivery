import { initializeApp } from 'firebase/app';
import { initializeFirestore, collection, getDocs, doc, getDoc } from 'firebase/firestore';

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
  const usersSnap = await getDocs(collection(db, 'users'));
  const users = {};
  usersSnap.forEach(d => {
    users[d.id] = d.data();
  });

  const comerciosSnap = await getDocs(collection(db, 'comercios'));
  comerciosSnap.forEach(d => {
    const data = d.data();
    const owner = users[data.ownerId];
    console.log(`Comercio: "${data.name}" | ID: ${d.id} | OwnerId: ${data.ownerId} | Owner Email: ${owner ? owner.email : 'unknown'}`);
  });
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
