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
  const comerciosSnap = await getDocs(collection(db, 'comercios'));
  const firstComercio = comerciosSnap.docs[0];
  console.log(`Comercio ID: ${firstComercio.id} Name: ${firstComercio.data().name}`);
  
  const catsSnap = await getDocs(collection(db, 'comercios', firstComercio.id, 'categories'));
  console.log('Categories:');
  catsSnap.forEach(catDoc => {
    console.log(JSON.stringify({ id: catDoc.id, ...catDoc.data() }));
  });

  const prodsSnap = await getDocs(collection(db, 'comercios', firstComercio.id, 'products'));
  console.log('Products sample fields:');
  prodsSnap.docs.slice(0, 15).forEach(prodDoc => {
    console.log(JSON.stringify({ id: prodDoc.id, name: prodDoc.data().name, categoryId: prodDoc.data().categoryId, brand: prodDoc.data().brand || null, marca: prodDoc.data().marca || null }));
  });
  
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
