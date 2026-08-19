import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, getDoc } from 'firebase/firestore';

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

async function inspectPatricio() {
  const usersSnap = await getDocs(collection(db, 'users'));
  const pat = usersSnap.docs.find(d => {
    const data = d.data();
    return (data.name || data.displayName || '').toLowerCase().includes('corsiglia') || (data.email || '').toLowerCase().includes('patriciocorsiglia');
  });

  if (!pat) {
    console.error('Patricio Corsiglia not found');
    process.exit(1);
  }

  console.log('Patricio Corsiglia UID:', pat.id, 'deliveryDebt:', pat.data().deliveryDebt, pat.data());
  process.exit(0);
}

inspectPatricio().catch(console.error);
