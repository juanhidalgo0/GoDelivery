import { initializeApp } from 'firebase/app';
import { initializeFirestore, doc, deleteDoc, updateDoc, getDoc } from 'firebase/firestore';

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
  const driverId = 'pmMXcjIfAhR3vUhLt5xcoYspLZr1';
  const txId = 'KOK4Ub2URQK1DskaVuLD'; // Sofia's August 1st canon_charge transaction
  const canonDocId = `${driverId}_2026-08-01`;

  console.log("Fetching Sofia's current state...");
  const userRef = doc(db, 'users', driverId);
  const userSnap = await getDoc(userRef);
  if (!userSnap.exists()) {
    console.error("Sofia not found!");
    process.exit(1);
  }

  const currentDebt = userSnap.data().deliveryDebt || 0;
  const newDebt = currentDebt - 1800;

  console.log(`Current Debt: $${currentDebt}`);
  console.log(`New Debt will be: $${newDebt}`);

  // 1. Delete from delivery_transactions
  console.log(`Deleting transaction document ${txId}...`);
  await deleteDoc(doc(db, 'delivery_transactions', txId));

  // 2. Delete from delivery_canon_payments
  console.log(`Deleting canon payment document ${canonDocId}...`);
  await deleteDoc(doc(db, 'delivery_canon_payments', canonDocId));

  // 3. Update Sofia's deliveryDebt
  console.log(`Updating Sofia's deliveryDebt to $${newDebt}...`);
  await updateDoc(userRef, { deliveryDebt: newDebt });

  console.log("Sofia's August 1st canon charge successfully deleted and debt adjusted.");
  process.exit(0);
}

run().catch(console.error);
