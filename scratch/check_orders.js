import admin from 'firebase-admin';

admin.initializeApp({
  projectId: "godelivery-magdalena"
});

const db = admin.firestore();

async function check() {
  console.log('--- Checking recent orders ---');
  const snap = await db.collection('orders').orderBy('createdAt', 'desc').limit(5).get();
  for (const doc of snap.docs) {
    const data = doc.data();
    console.log(`Order #${data.orderId} | ID: ${doc.id}`);
    console.log(`  createdAt: ${data.createdAt?.toDate()?.toISOString()}`);
    console.log(`  status: ${data.status}`);
    console.log(`  isScheduled: ${data.isScheduled} (type: ${typeof data.isScheduled})`);
    console.log(`  scheduledDate: ${data.scheduledDate}`);
    console.log(`  scheduledTime: ${data.scheduledTime}`);
    console.log(`  userName: ${data.userName}`);
    console.log(`  comercioId: ${data.comercioId}`);
  }
}

check().catch(console.error);
