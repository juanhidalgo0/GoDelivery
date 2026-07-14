import { initializeApp } from 'firebase/app';
import { initializeFirestore, collection, getDocs, query, where, collectionGroup } from 'firebase/firestore';

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
  const pSnap = await getDocs(collectionGroup(db, 'products'));
  const onlyInAppProds = pSnap.docs
    .map(d => ({ id: d.id, name: d.data().name, price: d.data().price }))
    .filter(p => p.price === 32000 || (p.name && (p.name.includes("30.400") || p.name.includes("32.000"))));

  console.log('Matching Products:');
  console.log(onlyInAppProds);

  const oSnap = await getDocs(query(collection(db, 'offers'), where('active', '==', true)));
  console.log('\nMatching Active Offers:');
  oSnap.docs.forEach(d => {
    const data = d.data();
    console.log(d.id, '=>', {
      type: data.type,
      value: data.value,
      productIds: data.productIds,
      comercioId: data.comercioId
    });
  });

  process.exit(0);
}

run().catch(console.error);
