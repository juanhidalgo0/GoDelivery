import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, collection, getDocs, query, where } from 'firebase/firestore';

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

async function checkJuan() {
  const usersSnap = await getDocs(collection(db, 'users'));
  const juanUser = usersSnap.docs.find(d => {
    const data = d.data();
    return (data.name || data.displayName || '').toLowerCase().includes('juan hidalgo');
  });

  if (juanUser) {
    console.log('Juan Hidalgo UID:', juanUser.id, juanUser.data());
    const uid = juanUser.id;
    const canonsSnap = await getDocs(query(collection(db, 'delivery_canon_payments'), where('driverId', '==', uid)));
    canonsSnap.docs.forEach(d => {
      const c = d.data();
      console.log('Juan Canon:', d.id, c.dateStr, '$' + c.amount, 'settled:', c.settled, 'status:', c.status);
    });
  } else {
    console.log('Juan Hidalgo not found!');
  }
  process.exit(0);
}

checkJuan().catch(console.error);
