import admin from 'firebase-admin';

admin.initializeApp({
  projectId: "godelivery-magdalena"
});

const db = admin.firestore();

async function check() {
  console.log('--- Checking user role ---');
  const doc = await db.collection('users').doc('7Sq9bA7OGuegcowu2ASktLmOSog2').get();
  if (doc.exists) {
    console.log('User found:', JSON.stringify(doc.data(), null, 2));
  } else {
    console.log('User NOT found!');
  }
}

check().catch(console.error);
