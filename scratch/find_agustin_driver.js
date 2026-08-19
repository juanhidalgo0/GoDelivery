import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';

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

async function findAgustinDriver() {
  const usersSnap = await getDocs(collection(db, 'users'));
  usersSnap.docs.forEach(d => {
    const u = d.data();
    const name = (u.name || u.displayName || '').toLowerCase();
    if (name.includes('agustin') || name.includes('yacachury')) {
      console.log('Driver match:', d.id, u.displayName || u.name, 'Debt:', u.deliveryDebt, 'Role:', u.role, 'isDelivery:', u.isDelivery);
    }
  });
  process.exit(0);
}

findAgustinDriver().catch(console.error);
