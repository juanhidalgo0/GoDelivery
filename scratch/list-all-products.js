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
  console.log('=== ARTESANO PRODUCTS ===');
  const artSnap = await getDocs(collection(db, 'comercios', 'GFG4CVkdOQensrrLFeMtu7HsMF03', 'products'));
  artSnap.forEach(d => {
    console.log(`ID: ${d.id} | Name: ${d.data().name} | categoryId: "${d.data().categoryId || ''}"`);
  });

  console.log('\n=== DANY\'S PIZZA PRODUCTS ===');
  const danySnap = await getDocs(collection(db, 'comercios', 'gEMDhoFnBIhvesPT9PoHmxL9I152', 'products'));
  danySnap.forEach(d => {
    console.log(`ID: ${d.id} | Name: ${d.data().name} | categoryId: "${d.data().categoryId || ''}"`);
  });

  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
