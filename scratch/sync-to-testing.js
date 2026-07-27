import admin from 'firebase-admin';

// Initialize Prod App
const prodApp = admin.initializeApp({
  projectId: 'godelivery-magdalena'
}, 'prod');

// Initialize Testing App
const testingApp = admin.initializeApp({
  projectId: 'godelivery-testing'
}, 'testing');

const prodDb = prodApp.firestore();
const testingDb = testingApp.firestore();

async function syncCollection(colName) {
  console.log(`\n📦 Migrating collection: ${colName}...`);
  const snap = await prodDb.collection(colName).get();
  console.log(`Found ${snap.size} documents in prod for '${colName}'.`);

  let count = 0;
  for (const doc of snap.docs) {
    const data = doc.data();
    await testingDb.collection(colName).doc(doc.id).set(data, { merge: true });
    
    // Copy subcollections if any (e.g. products inside comercios)
    const subcols = await doc.ref.listCollections();
    for (const subcol of subcols) {
      const subSnap = await subcol.get();
      console.log(`  └─ Copying subcollection '${subcol.id}' (${subSnap.size} docs) for parent '${doc.id}'...`);
      for (const subDoc of subSnap.docs) {
        await testingDb
          .collection(colName)
          .doc(doc.id)
          .collection(subcol.id)
          .doc(subDoc.id)
          .set(subDoc.data(), { merge: true });
      }
    }

    count++;
    if (count % 10 === 0 || count === snap.size) {
      console.log(`  Progress: ${count}/${snap.size} ${colName} copied.`);
    }
  }
  console.log(`✅ Collection '${colName}' migration complete!`);
}

async function main() {
  try {
    // Copy core data for testing
    await syncCollection('comercios');
    await syncCollection('platformCategories');
    await syncCollection('ads');
    await syncCollection('offers');
    await syncCollection('settings');
    console.log('\n🎉 ALL TESTING DATA SYNCED SUCCESSFULLY!');
  } catch (err) {
    console.error('Error during data migration:', err);
  } finally {
    process.exit(0);
  }
}

main();
