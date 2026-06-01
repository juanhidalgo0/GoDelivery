
import { db } from './src/firebase.js';
import { collection, getDocs, limit, query } from 'firebase/firestore';

async function checkSessions() {
  try {
    const q = query(collection(db, 'deliverySessions'), limit(10));
    const snap = await getDocs(q);
    console.log('Total sessions found:', snap.size);
    snap.forEach(d => {
      console.log('ID:', d.id, 'Data:', JSON.stringify(d.data()));
    });
  } catch (e) {
    console.error('Error checking sessions:', e);
  }
}

checkSessions();
