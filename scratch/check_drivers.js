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

async function checkDrivers() {
  const usersSnap = await getDocs(collection(db, 'users'));
  console.log('Total users:', usersSnap.size);

  const drivers = [];
  usersSnap.docs.forEach(docSnap => {
    const data = docSnap.data();
    const isDelivery = data.isDelivery === true || data.isDelivery === 'true' || ['delivery', 'driver', 'repartidor', 'chofer'].includes((data.role || '').toLowerCase());
    if (isDelivery) {
      drivers.push({ id: docSnap.id, name: data.name || data.displayName, role: data.role, isDelivery: data.isDelivery, isOnline: data.isOnline });
    }
  });

  console.log('Found drivers in DB:', drivers.length);
  drivers.forEach(d => console.log(d));
  process.exit(0);
}

checkDrivers().catch(console.error);
