import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, query, where } from 'firebase/firestore';

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

async function investigate() {
  const usersSnap = await getDocs(collection(db, 'users'));
  
  const alexaUser = usersSnap.docs.find(d => {
    const data = d.data();
    return (data.name || data.displayName || '').toLowerCase().includes('alexa');
  });

  const matiasUser = usersSnap.docs.find(d => {
    const data = d.data();
    return (data.name || data.displayName || '').toLowerCase().includes('matias gomez');
  });

  console.log('=== ALEXA USER DOC ===');
  if (alexaUser) {
    console.log('UID:', alexaUser.id, alexaUser.data());
  } else {
    console.log('Alexa not found!');
  }

  console.log('\n=== MATIAS GOMEZ USER DOC ===');
  if (matiasUser) {
    console.log('UID:', matiasUser.id, matiasUser.data());
  } else {
    console.log('Matías Gómez not found!');
  }

  if (alexaUser) {
    const uid = alexaUser.id;
    console.log('\n--- ALEXA ORDERS ---');
    const qO = query(collection(db, 'orders'), where('driverId', '==', uid));
    const snapO = await getDocs(qO);
    snapO.docs.forEach(d => {
      const o = d.data();
      console.log('Order:', d.id, 'status:', o.status, 'appUsageFee:', o.appUsageFee, 'isSettledDriver:', o.isSettledDriver, 'createdAt:', o.createdAt?.toDate ? o.createdAt.toDate().toISOString() : o.createdAt);
    });

    console.log('\n--- ALEXA CANONS ---');
    const qC = query(collection(db, 'delivery_canon_payments'), where('driverId', '==', uid));
    const snapC = await getDocs(qC);
    snapC.docs.forEach(d => {
      const c = d.data();
      console.log('Canon:', d.id, 'amount:', c.amount, 'settled:', c.settled, 'dateStr:', c.dateStr, 'createdAt:', c.createdAt?.toDate ? c.createdAt.toDate().toISOString() : c.createdAt);
    });
  }

  if (matiasUser) {
    const uid = matiasUser.id;
    console.log('\n--- MATIAS GOMEZ ORDERS ---');
    const qO = query(collection(db, 'orders'), where('driverId', '==', uid));
    const snapO = await getDocs(qO);
    snapO.docs.forEach(d => {
      const o = d.data();
      console.log('Order:', d.id, 'status:', o.status, 'appUsageFee:', o.appUsageFee, 'isSettledDriver:', o.isSettledDriver, 'createdAt:', o.createdAt?.toDate ? o.createdAt.toDate().toISOString() : o.createdAt);
    });

    console.log('\n--- MATIAS GOMEZ CANONS ---');
    const qC = query(collection(db, 'delivery_canon_payments'), where('driverId', '==', uid));
    const snapC = await getDocs(qC);
    snapC.docs.forEach(d => {
      const c = d.data();
      console.log('Canon:', d.id, 'amount:', c.amount, 'settled:', c.settled, 'dateStr:', c.dateStr, 'createdAt:', c.createdAt?.toDate ? c.createdAt.toDate().toISOString() : c.createdAt);
    });
  }

  process.exit(0);
}

investigate().catch(console.error);
