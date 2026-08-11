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
  const usersSnap = await getDocs(collection(db, 'users'));
  const exequiels = [];
  usersSnap.docs.forEach(d => {
    const data = d.data();
    const name = data.displayName || data.name || '';
    if (name.toLowerCase().includes('exequiel')) {
      exequiels.push({
        id: d.id,
        displayName: data.displayName,
        deliveryDebt: data.deliveryDebt,
        lastCanonChargeDate: data.lastCanonChargeDate,
        lastCanonDate: data.lastCanonDate,
        isOnline: data.isOnline
      });
    }
  });

  console.log(`Found ${exequiels.length} Exequiels.`);

  for (const exequiel of exequiels) {
    console.log(`\n========================================`);
    console.log(`Exequiel: ${exequiel.displayName} (${exequiel.id})`);
    console.log(`Delivery Debt: ${exequiel.deliveryDebt}`);
    console.log(`lastCanonChargeDate: ${exequiel.lastCanonChargeDate}`);

    const driverId = exequiel.id;

    // Query delivery_transactions
    console.log("--- Transactions ---");
    const txSnap = await getDocs(query(
      collection(db, 'delivery_transactions'),
      where('driverId', '==', driverId)
    ));
    const txs = txSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    txs.sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
    txs.forEach(t => {
      const dateStr = t.createdAt?.seconds ? new Date(t.createdAt.seconds * 1000).toLocaleString('es-AR') : 'unknown';
      console.log(`[Tx] ${dateStr} - Type: ${t.type} - Amount: ${t.amount} - Desc: ${t.description}`);
    });

    // Query delivery_canon_payments
    console.log("--- Canon Payments ---");
    const canonSnap = await getDocs(query(
      collection(db, 'delivery_canon_payments'),
      where('driverId', '==', driverId)
    ));
    const canons = canonSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    canons.sort((a, b) => a.dateStr.localeCompare(b.dateStr));
    canons.forEach(c => {
      const createdDate = c.createdAt?.seconds ? new Date(c.createdAt.seconds * 1000).toLocaleString('es-AR') : 'unknown';
      console.log(`[Canon] ID: ${c.id} - DateStr: ${c.dateStr} - Amount: ${c.amount} - Settled: ${c.settled} - CreatedAt: ${createdDate}`);
    });
  }

  process.exit(0);
}

run().catch(console.error);
