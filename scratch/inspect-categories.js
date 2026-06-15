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
  const comerciosSnap = await getDocs(collection(db, 'comercios'));
  for (const doc of comerciosSnap.docs) {
    console.log(`\n================ COMERCIO: ${doc.id} - ${doc.data().name} ================`);
    
    // Categories
    const catsSnap = await getDocs(collection(db, 'comercios', doc.id, 'categories'));
    console.log('Categories:');
    catsSnap.forEach(catDoc => {
      console.log(`  ID: ${catDoc.id} | Name: ${catDoc.data().name} | ParentId: ${catDoc.data().parentId || 'none'} | parentCategoryId: ${catDoc.data().parentCategoryId || 'none'}`);
    });
    
    // Check a few products to see if they have brand/marca or other fields
    const prodsSnap = await getDocs(collection(db, 'comercios', doc.id, 'products'));
    console.log('Sample Products:');
    let count = 0;
    prodsSnap.forEach(prodDoc => {
      if (count < 5) {
        console.log(`  Name: ${prodDoc.data().name} | CategoryId: ${prodDoc.data().categoryId} | Brand/Marca: ${prodDoc.data().marca || prodDoc.data().brand || 'none'} | FullDataKeys: ${Object.keys(prodDoc.data()).join(', ')}`);
        count++;
      }
    });
  }
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
