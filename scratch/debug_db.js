const admin = require('firebase-admin');
const serviceAccount = require('../functions/index.js') ? null : null; // we can initialize with default project credentials since it's running locally

if (!admin.apps.length) {
  // Use local ADC or default firebase config
  admin.initializeApp({
    projectId: 'godelivery-magdalena'
  });
}

const db = admin.firestore();

async function check() {
  console.log('--- RECENT ORDERS ---');
  const ordersSnap = await db.collection('orders').orderBy('createdAt', 'desc').limit(3).get();
  ordersSnap.forEach(doc => {
    const data = doc.data();
    console.log(`Order ID: ${doc.id}, orderId: ${data.orderId}, status: ${data.status}, total: ${data.total}, appUsageFee: ${data.appUsageFee}, couponCode: ${data.couponCode}, couponDiscount: ${data.couponDiscount}, couponAbsorbedBy: ${data.couponAbsorbedBy}`);
  });

  console.log('\n--- RECENT TRANSACTIONS ---');
  const transSnap = await db.collection('delivery_transactions').orderBy('createdAt', 'desc').limit(5).get();
  transSnap.forEach(doc => {
    const data = doc.data();
    console.log(`Trans ID: ${doc.id}, driverId: ${data.driverId}, type: ${data.type}, amount: ${data.amount}, description: ${data.description}`);
  });
}

check().catch(console.error);
