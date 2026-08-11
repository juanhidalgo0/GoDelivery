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

// August 1, 2026 00:00:00 in Argentina Time (UTC-3)
// 2026-08-01T00:00:00-03:00 is 2026-08-01T03:00:00Z
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
    // Check if user is a delivery driver
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

  const report = [];

  for (const driver of drivers) {
    const driverId = driver.id;
    const driverName = driver.displayName || driver.name || `Driver (${driverId})`;

    // 1. Determine last liquidation time from user doc or transactions
    let lastLiquidationMs = 0;
    let liquidationSource = 'none';

    if (driver.lastLiquidationAt) {
      const t = driver.lastLiquidationAt;
      lastLiquidationMs = t.toMillis ? t.toMillis() : new Date(t).getTime();
      liquidationSource = 'user_doc';
    }

    // Also scan transactions for any liquidation/settlement/pago transaction
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

    // Determine cutoff time
    let cutoffMs = AUG_1_2026_MS;
    let cutoffReason = 'August 1st (default)';

    if (lastLiquidationMs > 0) {
      cutoffMs = lastLiquidationMs;
      cutoffReason = `Last Liquidation (${new Date(lastLiquidationMs).toLocaleString('es-AR')} via ${liquidationSource})`;
    }

    // 2. Fetch all canon_charge transactions after cutoff
    const canonCharges = driverTxs.filter(t => {
      if (t.type !== 'canon_charge') return false;
      if (!t.createdAt) return false;
      const txMs = t.createdAt.seconds * 1000;
      return txMs >= cutoffMs;
    });

    // 3. Group by Argentina calendar day to collapse duplicates
    const groupedByDay = {};
    canonCharges.forEach(c => {
      const dateObj = new Date(c.createdAt.seconds * 1000);
      const dayStr = getArgDateStr(dateObj);
      if (!groupedByDay[dayStr]) {
        groupedByDay[dayStr] = [];
      }
      groupedByDay[dayStr].push(c);
    });

    // Calculate new debt
    let newDebt = 0;
    const collapsedCharges = [];
    const duplicates = [];

    Object.keys(groupedByDay).sort().forEach(dayStr => {
      const list = groupedByDay[dayStr];
      // We only count 1 charge per calendar day
      // Use the amount from the first transaction of that day, or standard amount
      const repCharge = list[0];
      const amount = Number(repCharge.amount) || 1800;
      newDebt += amount;
      
      collapsedCharges.push({
        dayStr,
        amount,
        txId: repCharge.id,
        createdAt: new Date(repCharge.createdAt.seconds * 1000)
      });

      if (list.length > 1) {
        list.slice(1).forEach(dup => {
          duplicates.push({
            dayStr,
            amount: Number(dup.amount) || 1800,
            txId: dup.id,
            createdAt: new Date(dup.createdAt.seconds * 1000)
          });
        });
      }
    });

    report.push({
      driverId,
      driverName,
      currentDebt: driver.deliveryDebt || 0,
      cutoffReason,
      cutoffDateStr: new Date(cutoffMs).toLocaleString('es-AR'),
      newDebt,
      collapsedCharges,
      duplicates
    });
  }

  // Print results
  console.log("\n=== DRIVER DEBT CALCULATION REPORT ===");
  report.forEach(r => {
    console.log(`\nDriver: ${r.driverName} (${r.driverId})`);
    console.log(`  Current Debt: $${r.currentDebt}`);
    console.log(`  Cutoff: ${r.cutoffReason}`);
    console.log(`  Calculated New Debt: $${r.newDebt}`);
    if (r.collapsedCharges.length > 0) {
      console.log(`  Charges included (${r.collapsedCharges.length}):`);
      r.collapsedCharges.forEach(c => {
        console.log(`    - ${c.dayStr}: $${c.amount} (Tx: ${c.txId})`);
      });
    } else {
      console.log(`  No charges since cutoff.`);
    }
    if (r.duplicates.length > 0) {
      console.log(`  Duplicates collapsed (${r.duplicates.length}):`);
      r.duplicates.forEach(d => {
        console.log(`    - ${d.dayStr}: $${d.amount} (Tx: ${d.txId} at ${d.createdAt.toLocaleTimeString('es-AR')})`);
      });
    }
  });

  process.exit(0);
}

run().catch(console.error);
