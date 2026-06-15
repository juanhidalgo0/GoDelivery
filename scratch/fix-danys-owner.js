import { initializeApp } from 'firebase/app';
import { initializeFirestore, doc, updateDoc } from 'firebase/firestore';

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
  const docRef = doc(db, 'comercios', 'gEMDhoFnBIhvesPT9PoHmxL9I152');
  await updateDoc(docRef, {
    ownerId: 'gEMDhoFnBIhvesPT9PoHmxL9I152'
  });
  console.log("Dany's Pizza ownerId restored successfully to gEMDhoFnBIhvesPT9PoHmxL9I152");
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
