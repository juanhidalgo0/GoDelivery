// One-off backfill: seeds `salesCount` on existing products from historical orders,
// so the home "más pedidos" ranking isn't empty while new orders (which increment
// salesCount live via onOrderCreated in index.js) accumulate.
//
// Historical order docs only ever stored the product's `name` (no productId), so this
// script matches by comercioId + exact product name — same fallback the old N+1 query
// used, but run once here instead of on every home page load.
//
// Run manually with: node functions/backfill_sales_count.mjs
// Requires Application Default Credentials for the godelivery-magdalena project.

import admin from 'firebase-admin';

admin.initializeApp({ projectId: 'godelivery-magdalena' });
const db = admin.firestore();

async function collectHistoricalCounts() {
  const counts = new Map(); // "comercioId::productName" -> qty
  let lastDoc = null;
  let processed = 0;
  const pageSize = 500;

  while (true) {
    let q = db.collection('orders').orderBy('createdAt').limit(pageSize);
    if (lastDoc) q = q.startAfter(lastDoc);
    const snap = await q.get();
    if (snap.empty) break;

    snap.forEach(doc => {
      const data = doc.data();
      if (data.status === 'cancelled' || !data.comercioId) return;
      const items = data.items || data.productos || [];
      items.forEach(item => {
        const name = (item.name || '').trim();
        if (!name) return;
        const key = `${data.comercioId}::${name}`;
        counts.set(key, (counts.get(key) || 0) + (item.qty || item.quantity || 1));
      });
    });

    processed += snap.size;
    lastDoc = snap.docs[snap.docs.length - 1];
    console.log(`  procesadas ${processed} órdenes...`);
    if (snap.size < pageSize) break;
  }

  return counts;
}

async function applyCounts(counts) {
  let updated = 0;
  let notFound = 0;

  for (const [key, qty] of counts.entries()) {
    const sep = key.indexOf('::');
    const comercioId = key.slice(0, sep);
    const name = key.slice(sep + 2);

    const pq = await db.collection('comercios').doc(comercioId)
      .collection('products').where('name', '==', name).limit(1).get();

    if (pq.empty) {
      notFound++;
      continue;
    }

    await pq.docs[0].ref.update({
      salesCount: admin.firestore.FieldValue.increment(qty)
    });
    updated++;
  }

  return { updated, notFound };
}

async function run() {
  console.log('--- Leyendo historial de órdenes ---');
  const counts = await collectHistoricalCounts();
  console.log(`Encontrados ${counts.size} pares comercio+producto con ventas históricas.`);

  console.log('--- Aplicando salesCount a los productos ---');
  const { updated, notFound } = await applyCounts(counts);

  console.log(`\n✅ Listo. Productos actualizados: ${updated}. Sin match (producto renombrado/eliminado): ${notFound}.`);
}

run().catch(err => {
  console.error('Error en el backfill:', err);
  process.exit(1);
});
