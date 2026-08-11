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
  console.log("Fetching drivers to map IDs to names...");
  const usersSnap = await getDocs(collection(db, 'users'));
  const driverNames = {};
  usersSnap.docs.forEach(d => {
    const data = d.data();
    driverNames[d.id] = data.displayName || data.name || `Driver (${d.id})`;
  });

  console.log("Fetching all canon_charge transactions...");
  const txSnap = await getDocs(query(
    collection(db, 'delivery_transactions'),
    where('type', '==', 'canon_charge')
  ));

  const charges = [];
  txSnap.docs.forEach(docDoc => {
    const t = docDoc.data();
    if (!t.createdAt || !t.driverId) return;
    
    // Extract date from description or timestamp
    let dateStr = '';
    const descMatch = t.description?.match(/\((\d{4}-\d{2}-\d{2})\)/);
    if (descMatch) {
      dateStr = descMatch[1];
    } else {
      const d = new Date(t.createdAt.seconds * 1000);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      dateStr = `${year}-${month}-${day}`;
    }

    charges.push({
      id: docDoc.id,
      driverId: t.driverId,
      driverName: driverNames[t.driverId] || t.driverId,
      dateStr,
      amount: t.amount,
      createdAt: new Date(t.createdAt.seconds * 1000)
    });
  });

  // Group by driver and date
  const groups = {};
  charges.forEach(c => {
    const key = `${c.driverId}_${c.dateStr}`;
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(c);
  });

  console.log("\n=== DUPLICATE CHARGES FOUND ===");
  let duplicateCount = 0;
  Object.keys(groups).forEach(key => {
    const list = groups[key];
    if (list.length > 1) {
      duplicateCount++;
      const first = list[0];
      console.log(`\nDriver: ${first.driverName} (${first.driverId})`);
      console.log(`Date: ${first.dateStr}`);
      console.log(`Charges (${list.length}):`);
      list.sort((a, b) => a.createdAt - b.createdAt);
      list.forEach(c => {
        console.log(`  - Tx ID: ${c.id} at ${c.createdAt.toLocaleString('es-AR')} (Amount: $${c.amount})`);
      });
    }
  });

  if (duplicateCount === 0) {
    console.log("No other drivers with duplicate charges found.");
  }

  process.exit(0);
}

run().catch(console.error);
