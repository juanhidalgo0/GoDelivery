import { initializeApp } from 'firebase/app';
import { initializeFirestore, collection, getDocs, doc, deleteDoc, query, where } from 'firebase/firestore';

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

function getArgDateStr(dateObj) {
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
  return `${year}-${month}-${day}`;
}

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
    
    const dateObj = new Date(t.createdAt.seconds * 1000);
    const argDateStr = getArgDateStr(dateObj);

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

  console.log("\n=== DELETING DUPLICATE TRANSACTIONS ===");
  let deletedTxsCount = 0;
  let deletedCanonsCount = 0;

  for (const key of Object.keys(groups)) {
    const list = groups[key];
    if (list.length > 1) {
      // Sort chronologically to keep the FIRST one
      list.sort((a, b) => a.createdAt - b.createdAt);
      
      const primary = list[0];
      const duplicates = list.slice(1);

      console.log(`\nDriver: ${primary.driverName} (${primary.driverId}) on calendar day ${primary.argDateStr}`);
      console.log(`  Keeping primary transaction: ${primary.id} at ${primary.createdAt.toLocaleString('es-AR')}`);

      for (const dup of duplicates) {
        console.log(`  Deleting duplicate transaction: ${dup.id} at ${dup.createdAt.toLocaleString('es-AR')} | Desc: ${dup.description}`);
        
        // 1. Delete from delivery_transactions
        const txDocRef = doc(db, 'delivery_transactions', dup.id);
        await deleteDoc(txDocRef);
        deletedTxsCount++;

        // 2. Extract dateStr from description (e.g. "Canon Diario Jornada (2026-08-07)" -> "2026-08-07")
        // and delete from delivery_canon_payments
        const descMatch = dup.description?.match(/\((\d{4}-\d{2}-\d{2})\)/);
        if (descMatch) {
          const targetDateStr = descMatch[1];
          const canonDocId = `${dup.driverId}_${targetDateStr}`;
          const canonDocRef = doc(db, 'delivery_canon_payments', canonDocId);
          
          console.log(`  Deleting corresponding payment doc: ${canonDocId}`);
          await deleteDoc(canonDocRef);
          deletedCanonsCount++;
        }
      }
    }
  }

  console.log(`\n=== CLEANUP COMPLETE ===`);
  console.log(`Deleted duplicate transactions: ${deletedTxsCount}`);
  console.log(`Deleted payment documents: ${deletedCanonsCount}`);

  process.exit(0);
}

run().catch(console.error);
