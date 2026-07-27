import { initializeApp } from 'firebase/app';
import { 
  getFirestore, 
  collection, 
  getDocs, 
  doc, 
  setDoc 
} from 'firebase/firestore';

const prodConfig = {
  apiKey: "AIzaSyAldeFtUWWlEpcuEg1LSTko90cVEvnsMLA",
  authDomain: "godelivery-magdalena.firebaseapp.com",
  projectId: "godelivery-magdalena",
  storageBucket: "godelivery-magdalena.firebasestorage.app",
  messagingSenderId: "848164656125",
  appId: "1:848164656125:web:eef2314205f5d8f887ff94"
};

const testingConfig = {
  apiKey: "AIzaSyDqyQ6aRA_1q0E8GUb6nqXIJhghzD4L00A",
  authDomain: "godelivery-testing.firebaseapp.com",
  projectId: "godelivery-testing",
  storageBucket: "godelivery-testing.firebasestorage.app",
  messagingSenderId: "584541077992",
  appId: "1:584541077992:web:20c37a8b58595bf510e45d"
};

const prodApp = initializeApp(prodConfig, 'prod');
const testingApp = initializeApp(testingConfig, 'testing');

const prodDb = getFirestore(prodApp);
const testingDb = getFirestore(testingApp);

async function syncCollection(colName) {
  console.log(`\n📦 Migrando colección: ${colName}...`);
  const snap = await getDocs(collection(prodDb, colName));
  console.log(`Encontrados ${snap.docs.length} documentos en producción para '${colName}'.`);

  let count = 0;
  for (const d of snap.docs) {
    const data = d.data();
    await setDoc(doc(testingDb, colName, d.id), data, { merge: true });

    // Try migrating products subcollection for comercios
    if (colName === 'comercios') {
      try {
        const prodSubSnap = await getDocs(collection(prodDb, 'comercios', d.id, 'products'));
        for (const subDoc of prodSubSnap.docs) {
          await setDoc(doc(testingDb, 'comercios', d.id, 'products', subDoc.id), subDoc.data(), { merge: true });
        }
        if (prodSubSnap.docs.length > 0) {
          console.log(`  └─ Copiados ${prodSubSnap.docs.length} productos para comercio ${d.id}`);
        }
      } catch (e) {
        console.warn(`  └─ Error copiando productos para ${d.id}:`, e);
      }
    }

    count++;
  }
  console.log(`✅ Colección '${colName}' copiada exitosamente!`);
}

async function runSync() {
  try {
    await syncCollection('comercios');
    await syncCollection('platformCategories');
    await syncCollection('ads');
    await syncCollection('offers');
    await syncCollection('settings');
    console.log('\n🎉 ¡TODOS LOS DATOS FUERON COPIADOS A TESTING CON ÉXITO!');
  } catch (err) {
    console.error('Error durante la migración:', err);
  }
}

window.runCatalogSync = runSync;
console.log("👉 Ejecutá 'runCatalogSync()' en la consola para copiar todos los comercios y catálogo a testing.");
