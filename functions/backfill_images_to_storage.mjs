// One-off backfill: migrates base64 images embedded in Firestore documents
// (comercios, products, customAds, banners_mandados, marketplace_products)
// to Firebase Storage, replacing the field with a download URL.
//
// Run manually with: node functions/backfill_images_to_storage.mjs
// Requires Application Default Credentials for the godelivery-magdalena project
// (same auth setup already used by functions/check_orders.js etc).

import admin from 'firebase-admin';
import crypto from 'crypto';

admin.initializeApp({
  projectId: 'godelivery-magdalena',
  storageBucket: 'godelivery-magdalena.firebasestorage.app'
});

const db = admin.firestore();
const bucket = admin.storage().bucket();

let migratedDocs = 0;
let uploadedFiles = 0;
let base64BytesRemoved = 0;

function parseDataUrl(dataUrl) {
  const match = /^data:(.+?);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  return { mime: match[1], buffer: Buffer.from(match[2], 'base64') };
}

function extensionFor(mime) {
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/png') return 'png';
  return 'bin';
}

async function uploadBase64(dataUrl, storagePath) {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return null;
  const token = crypto.randomUUID();
  const filePath = `${storagePath}_${Date.now()}.${extensionFor(parsed.mime)}`;
  const file = bucket.file(filePath);
  await file.save(parsed.buffer, {
    metadata: {
      contentType: parsed.mime,
      metadata: { firebaseStorageDownloadTokens: token }
    }
  });
  uploadedFiles++;
  const encodedPath = encodeURIComponent(filePath);
  return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodedPath}?alt=media&token=${token}`;
}

// Migrates any base64 string fields (and string arrays) on a doc to Storage URLs.
async function migrateDoc(docRef, data, fields, storagePrefix) {
  const updates = {};
  for (const field of fields) {
    const val = data[field];
    if (typeof val === 'string' && val.startsWith('data:image')) {
      base64BytesRemoved += val.length;
      const url = await uploadBase64(val, `${storagePrefix}/${field}`);
      if (url) updates[field] = url;
    } else if (Array.isArray(val)) {
      let changed = false;
      const newArr = [];
      for (let i = 0; i < val.length; i++) {
        const item = val[i];
        if (typeof item === 'string' && item.startsWith('data:image')) {
          base64BytesRemoved += item.length;
          const url = await uploadBase64(item, `${storagePrefix}/${field}_${i}`);
          newArr.push(url || item);
          changed = true;
        } else {
          newArr.push(item);
        }
      }
      if (changed) updates[field] = newArr;
    }
  }
  if (Object.keys(updates).length > 0) {
    await docRef.update(updates);
    migratedDocs++;
    console.log(`  ✓ ${docRef.path}`);
  }
}

async function migrateComercios() {
  console.log('--- comercios (logo/banner) ---');
  const snap = await db.collection('comercios').get();
  for (const doc of snap.docs) {
    await migrateDoc(doc.ref, doc.data(), ['logo', 'banner'], `comercios/${doc.id}`);
  }
}

async function migrateProducts() {
  console.log('--- comercios/*/products (image/imageUrl) ---');
  const snap = await db.collectionGroup('products').get();
  for (const doc of snap.docs) {
    const comercioId = doc.ref.parent.parent.id;
    await migrateDoc(doc.ref, doc.data(), ['image', 'imageUrl'], `products/${comercioId}/${doc.id}`);
  }
}

async function migrateCustomAds() {
  console.log('--- customAds (banner) ---');
  const snap = await db.collection('customAds').get();
  for (const doc of snap.docs) {
    await migrateDoc(doc.ref, doc.data(), ['banner'], `ads/custom/${doc.id}`);
  }
}

async function migrateBannersMandados() {
  console.log('--- banners_mandados (imageUrl/logoUrl) ---');
  const snap = await db.collection('banners_mandados').get();
  for (const doc of snap.docs) {
    await migrateDoc(doc.ref, doc.data(), ['imageUrl', 'logoUrl'], `ads/banners_mandados/${doc.id}`);
  }
}

async function migrateMarketplace() {
  console.log('--- marketplace_products (images[]) ---');
  const snap = await db.collection('marketplace_products').get();
  for (const doc of snap.docs) {
    await migrateDoc(doc.ref, doc.data(), ['images'], `marketplace/${doc.id}`);
  }
}

async function migrateUserAvatars() {
  console.log('--- users (photoURL) ---');
  const snap = await db.collection('users').get();
  for (const doc of snap.docs) {
    await migrateDoc(doc.ref, doc.data(), ['photoURL'], `avatars/${doc.id}`);
  }
}

async function run() {
  await migrateComercios();
  await migrateProducts();
  await migrateCustomAds();
  await migrateBannersMandados();
  await migrateMarketplace();
  await migrateUserAvatars();
  console.log(`\n✅ Listo. Documentos actualizados: ${migratedDocs}. Archivos subidos a Storage: ${uploadedFiles}. Base64 removido de Firestore: ~${(base64BytesRemoved / 1024 / 1024).toFixed(2)} MB`);
}

run().catch(err => {
  console.error('Error en la migración:', err);
  process.exit(1);
});
