import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, updateDoc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyDFaOVxf6QfK03rRTVfIH84HLc5Qujzrew",
  authDomain: "godelivery-magdalena.firebaseapp.com",
  projectId: "godelivery-magdalena",
  storageBucket: "godelivery-magdalena.firebasestorage.app",
  messagingSenderId: "848164656125",
  appId: "1:848164656125:web:86b4a5df1ab82cae7eb886"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function fixNegativeDebts() {
  console.log('=== FIXING NEGATIVE DEBTS IN FIRESTORE ===');
  const usersSnap = await getDocs(collection(db, 'users'));
  let count = 0;

  for (const d of usersSnap.docs) {
    const u = d.data();
    if (u.deliveryDebt && u.deliveryDebt < 0) {
      console.log(`Fixing driver ${d.id} (${u.displayName || u.name}): deliveryDebt ${u.deliveryDebt} -> 0`);
      await updateDoc(doc(db, 'users', d.id), {
        deliveryDebt: 0
      });
      count++;
    }
  }

  console.log(`Updated ${count} drivers with negative deliveryDebt to 0`);
  process.exit(0);
}

fixNegativeDebts().catch(console.error);
