import { initializeApp } from 'firebase/app';
import { initializeFirestore, collection, getDocs, query, where } from 'firebase/firestore';

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
  const usersSnap = await getDocs(query(collection(db, 'users'), where('isOnline', '==', true)));
  console.log("=== ONLINE USERS ===");
  usersSnap.docs.forEach(d => {
    console.log(d.id, "=>", JSON.stringify(d.data()));
  });

  process.exit(0);
}

run().catch(console.error);
