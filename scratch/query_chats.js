import { initializeApp } from 'firebase/app';
import { initializeFirestore, collection, getDocs } from 'firebase/firestore';

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
  console.log("=== MESSAGES FOR ba94s9QVwWeW74b25Hdi_client-commerce ===");
  const snap = await getDocs(collection(db, 'chats', 'ba94s9QVwWeW74b25Hdi_client-commerce', 'messages'));
  for (const d of snap.docs) {
    console.log(d.id, "=>", JSON.stringify(d.data()));
  }
  process.exit(0);
}

run().catch(console.error);
