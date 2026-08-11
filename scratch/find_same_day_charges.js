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
    
    // Get Argentina calendar date
    const dateObj = new Date(t.createdAt.seconds * 1000);
    // Convert to Argentina timezone date string: YYYY-MM-DD
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Argentina/Buenos_Aires',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    const parts = formatter.formatToParts(dateObj);
    const year = parts.find(p => p.type === 'year').value;
    const month = parts.find(p => p.type === 'month').value;
    const day = parts.find(p => p.type === 'day').value;
    const argDateStr = `${year}-${month}-${day}`;

    charges.push({
      id: docDoc.id,
      driverId: t.driverId,
      driverName: driverNames[t.driverId] || t.driverId,
      argDateStr,
      description: t.description || '',
      amount: t.amount,
      createdAt: dateObj
    });
  });

  // Group by driver and Argentina calendar date
  const groups = {};
  charges.forEach(c => {
    const key = `${c.driverId}_${c.argDateStr}`;
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(c);
  });

  console.log("\n=== MULTIPLE CHARGES ON THE SAME CALENDAR DAY (ARGENTINA TIME) ===");
  let duplicateCount = 0;
  Object.keys(groups).forEach(key => {
    const list = groups[key];
    if (list.length > 1) {
      duplicateCount++;
      const first = list[0];
      console.log(`\nDriver: ${first.driverName} (${first.driverId})`);
      console.log(`Argentina Date: ${first.argDateStr}`);
      console.log(`Charges (${list.length}):`);
      list.sort((a, b) => a.createdAt - b.createdAt);
      list.forEach(c => {
        console.log(`  - Tx ID: ${c.id} at ${c.createdAt.toLocaleString('es-AR')} (Amount: $${c.amount}) | Desc: ${c.description}`);
      });
    }
  });

  if (duplicateCount === 0) {
    console.log("No drivers with multiple charges on the same day found.");
  }

  process.exit(0);
}

run().catch(console.error);
