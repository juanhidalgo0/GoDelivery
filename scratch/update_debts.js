import { initializeApp } from 'firebase/app';
import { initializeFirestore, collection, getDocs, doc, updateDoc, query, where } from 'firebase/firestore';

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

const AUG_1_2026_MS = new Date('2026-08-01T03:00:00Z').getTime();

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
  console.log("Fetching all users...");
  const usersSnap = await getDocs(collection(db, 'users'));
  const drivers = [];
  usersSnap.docs.forEach(docDoc => {
    const data = docDoc.data();
    if (data.isDelivery === true || data.role === 'delivery' || data.deliveryDebt !== undefined) {
      drivers.push({
        id: docDoc.id,
        ...data
      });
    }
  });

  console.log(`Found ${drivers.length} delivery drivers.`);

  console.log("Fetching all delivery_transactions...");
  const txSnap = await getDocs(collection(db, 'delivery_transactions'));
  const allTxs = txSnap.docs.map(docDoc => ({ id: docDoc.id, ...docDoc.data() }));

  console.log("\nUpdating driver debts in Firestore...");
  const updates = [];

  for (const driver of drivers) {
    const driverId = driver.id;
    const driverName = driver.displayName || driver.name || `Driver (${driverId})`;

    // Determine last liquidation time
    let lastLiquidationMs = 0;
    let liquidationSource = 'none';

    if (driver.lastLiquidationAt) {
      const t = driver.lastLiquidationAt;
      lastLiquidationMs = t.toMillis ? t.toMillis() : new Date(t).getTime();
      liquidationSource = 'user_doc';
    }

    const driverTxs = allTxs.filter(t => t.driverId === driverId);
    const liqTxs = driverTxs.filter(t => t.type === 'liquidation' || t.type === 'settlement' || t.type === 'pago');
    liqTxs.forEach(t => {
      if (t.createdAt) {
        const ms = t.createdAt.seconds * 1000;
        if (ms > lastLiquidationMs) {
          lastLiquidationMs = ms;
          liquidationSource = 'transactions';
        }
      }
    });

    let cutoffMs = AUG_1_2026_MS;
    let cutoffReason = 'August 1st (default)';

    if (lastLiquidationMs > 0) {
      cutoffMs = lastLiquidationMs;
      cutoffReason = `Last Liquidation (${new Date(lastLiquidationMs).toLocaleString('es-AR')} via ${liquidationSource})`;
    }

    // Fetch canon charges
    const canonCharges = driverTxs.filter(t => {
      if (t.type !== 'canon_charge') return false;
      if (!t.createdAt) return false;
      const txMs = t.createdAt.seconds * 1000;
      return txMs >= cutoffMs;
    });

    // Group and collapse
    const groupedByDay = {};
    canonCharges.forEach(c => {
      const dateObj = new Date(c.createdAt.seconds * 1000);
      const dayStr = getArgDateStr(dateObj);
      if (!groupedByDay[dayStr]) {
        groupedByDay[dayStr] = [];
      }
      groupedByDay[dayStr].push(c);
    });

    let newDebt = 0;
    Object.keys(groupedByDay).forEach(dayStr => {
      const list = groupedByDay[dayStr];
      const amount = Number(list[0].amount) || 1800;
      newDebt += amount;
    });

    const oldDebt = driver.deliveryDebt || 0;

    if (oldDebt !== newDebt) {
      // Update in firestore
      const userRef = doc(db, 'users', driverId);
      await updateDoc(userRef, { deliveryDebt: newDebt });
      
      updates.push({
        driverName,
        driverId,
        oldDebt,
        newDebt,
        cutoffReason,
        chargesCount: Object.keys(groupedByDay).length
      });
      console.log(`Updated ${driverName}: $${oldDebt} -> $${newDebt}`);
    } else {
      console.log(`Skipped ${driverName} (Debt is already $${oldDebt})`);
    }
  }

  console.log(`\n=== UPDATE COMPLETE. TOTAL UPDATED: ${updates.length} ===`);
  process.exit(0);
}

run().catch(console.error);
