import { initializeApp } from 'firebase/app';
import { initializeFirestore, updateDoc, doc, deleteField } from 'firebase/firestore';

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
  const uid = 'Ev2OLaqIrETTEKKWV3R1TOF6TzG3';
  console.log("=== FIXING USER", uid, "===");
  
  await updateDoc(doc(db, 'users', uid), {
    role: 'user',
    isDelivery: false,
    deliveryStatus: deleteField(),
    deliveryId: deleteField(),
    deliveryMode: deleteField(),
    tripStatus: deleteField()
  });
  
  console.log("Updated successfully!");
  process.exit(0);
}

run().catch(console.error);
