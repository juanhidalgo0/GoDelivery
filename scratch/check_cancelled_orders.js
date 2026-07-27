import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

const serviceAccount = JSON.parse(
  readFileSync('./functions/godelivery-magdalena-firebase-adminsdk-m1g90-9941a5ca66.json', 'utf8')
);

initializeApp({
  credential: cert(serviceAccount)
});

const db = getFirestore();

async function run() {
  const snap = await db.collection('orders')
    .orderBy('createdAt', 'desc')
    .limit(5)
    .get();

  console.log('--- LAST 5 ORDERS ---');
  snap.docs.forEach(doc => {
    const data = doc.data();
    console.log(`Order ID: ${doc.id}`);
    console.log(`Comercio: ${data.comercioName}`);
    console.log(`Status: ${data.status}`);
    console.log(`Created At: ${data.createdAt?.toDate()}`);
    console.log(`Cancel Reason: ${data.cancelReason || 'N/A'}`);
    console.log(`Cancelled At: ${data.cancelledAt?.toDate() || 'N/A'}`);
    console.log('--------------------');
  });
}

run().catch(console.error);
