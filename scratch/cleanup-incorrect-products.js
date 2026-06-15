import { initializeApp } from 'firebase/app';
import { initializeFirestore, collection, getDocs, doc, deleteDoc } from 'firebase/firestore';

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
  // 1. Clean Artesano (GFG4CVkdOQensrrLFeMtu7HsMF03)
  console.log('--- CLEANING ARTESANO ---');
  const artesanoProdsSnap = await getDocs(collection(db, 'comercios', 'GFG4CVkdOQensrrLFeMtu7HsMF03', 'products'));
  let artesanoDeleted = 0;
  for (const pDoc of artesanoProdsSnap.docs) {
    const data = pDoc.data();
    // Keep only ice cream products (categoryId should match 'z5tscMoNjZwj5w0mk2EN')
    if (data.categoryId !== 'z5tscMoNjZwj5w0mk2EN') {
      console.log(`Deleting from Artesano: "${data.name}"`);
      await deleteDoc(doc(db, 'comercios', 'GFG4CVkdOQensrrLFeMtu7HsMF03', 'products', pDoc.id));
      artesanoDeleted++;
    }
  }
  console.log(`Deleted ${artesanoDeleted} incorrect products from Artesano.`);

  // 2. Clean Dany's Pizza (gEMDhoFnBIhvesPT9PoHmxL9I152)
  console.log('\n--- CLEANING DANY\'S PIZZA ---');
  // Categories: Dany's Pizza should only have PIZZA (7fHTUZkILzQIkbdTJr0U) and EMPANADAS (yIGnHzXEdSIhYzE0ofgX)
  const allowedPizzaCats = ['7fHTUZkILzQIkbdTJr0U', 'yIGnHzXEdSIhYzE0ofgX'];
  
  // Clean categories first
  const pizzaCatsSnap = await getDocs(collection(db, 'comercios', 'gEMDhoFnBIhvesPT9PoHmxL9I152', 'categories'));
  for (const cDoc of pizzaCatsSnap.docs) {
    if (!allowedPizzaCats.includes(cDoc.id)) {
      console.log(`Deleting category from Dany's Pizza: "${cDoc.data().name}"`);
      await deleteDoc(doc(db, 'comercios', 'gEMDhoFnBIhvesPT9PoHmxL9I152', 'categories', cDoc.id));
    }
  }

  // Clean products
  const pizzaProdsSnap = await getDocs(collection(db, 'comercios', 'gEMDhoFnBIhvesPT9PoHmxL9I152', 'products'));
  let pizzaDeleted = 0;
  for (const pDoc of pizzaProdsSnap.docs) {
    const data = pDoc.data();
    if (!allowedPizzaCats.includes(data.categoryId)) {
      console.log(`Deleting product from Dany's Pizza: "${data.name}"`);
      await deleteDoc(doc(db, 'comercios', 'gEMDhoFnBIhvesPT9PoHmxL9I152', 'products', pDoc.id));
      pizzaDeleted++;
    }
  }
  console.log(`Deleted ${pizzaDeleted} incorrect products from Dany's Pizza.`);
  
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
