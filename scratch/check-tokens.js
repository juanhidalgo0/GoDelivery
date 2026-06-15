import admin from 'firebase-admin';

// Initialize firebase admin using default credentials (local environment is logged in via firebase CLI)
process.env.FIRESTORE_EMULATOR_HOST = ''; // Ensure connecting to production
admin.initializeApp({
  projectId: "godelivery-magdalena"
});

const db = admin.firestore();

async function check() {
  console.log('--- Checking users and FCM tokens ---');
  const usersSnap = await db.collection('users').get();
  for (const uDoc of usersSnap.docs) {
    const data = uDoc.data();
    console.log(`User: ${uDoc.id} | Name: ${data.displayName || data.name} | Role: ${data.role}`);
    const tokensSnap = await db.collection('users').doc(uDoc.id).collection('fcmTokens').get();
    if (tokensSnap.empty) {
      console.log('  -> No FCM tokens registered');
    } else {
      tokensSnap.docs.forEach(tDoc => {
        const tData = tDoc.data();
        console.log(`  -> Token: ${tDoc.id.substring(0, 15)}... | Platform: ${tData.platform} | Updated: ${tData.updatedAt?.toDate()}`);
      });
    }
  }
}

check().catch(console.error);
