// Tienda de muestra "Carnicería Arias" en GO (producción): oculta (isActive false), sin dueño,
// con cortes argentinos por peso. Las fotos son de Pexels (uso libre) y los precios por kilo son
// de referencia (relevamientos de septiembre de 2026); se cambian más adelante desde el panel.
//
//   node scripts/demo-carniceria-arias.mjs <credenciales-admin.json>
//
// Se puede correr de nuevo: reusa el comercio por nombre y reemplaza sus productos y rubros.
import { createRequire } from 'module';
import fs from 'fs';

const require = createRequire(new URL('../functions/package.json', import.meta.url));
const admin = require('firebase-admin');
const { FieldValue, Timestamp } = require('firebase-admin/firestore');

const credPath = process.argv[2];
if (!credPath) throw new Error('Falta la ruta de las credenciales de administrador de GO');
const cred = JSON.parse(fs.readFileSync(credPath, 'utf8'));
if (cred.project_id !== 'godelivery-magdalena') throw new Error('Las credenciales no son de godelivery-magdalena');
admin.initializeApp({ credential: admin.credential.cert(cred), projectId: cred.project_id });
const db = admin.firestore();

const NAME = 'Carnicería Arias';
const photo = (id, w = 800) => `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=${w}`;

const CATEGORIES = ['Para la parrilla', 'Cortes para cocinar', 'Achuras y embutidos', 'Cerdo y pollo'];
// [rubro, nombre, precio por kilo, de a cuántos gramos, foto, descripción]
const CUTS = [
  [0, 'Asado de tira', 23000, 500, 12884544, 'El clásico del domingo. Tiras parejas, con su grasa justa.'],
  [0, 'Vacío', 24500, 500, 5045088, 'Jugoso y con sabor. Ideal a la parrilla, bien a punto.'],
  [0, 'Matambre', 23500, 500, 28881690, 'Para la parrilla o arrollado. Lo limpiamos si lo pedís.'],
  [0, 'Entraña', 28000, 500, 20187067, 'Tierna y sabrosa, se hace en minutos sobre las brasas.'],
  [0, 'Tapa de asado', 20500, 500, 4765653, 'Corte rendidor para la parrilla o el horno.'],
  [0, 'Bife de chorizo', 24500, 500, 5313880, 'Bifes altos, cortados en el momento.'],
  [0, 'Ojo de bife', 27500, 500, 33157191, 'Bien marmolado, el más jugoso de los bifes.'],
  [0, 'Colita de cuadril', 26000, 500, 37414915, 'Entera o en bifes. Tierna y con poca grasa.'],
  [1, 'Lomo', 35000, 500, 10201880, 'El corte más tierno. Entero o en medallones.'],
  [1, 'Nalga para milanesas', 25000, 500, 4661802, 'Cortada fina para milanesas o bifes a la plancha.'],
  [1, 'Peceto', 26500, 500, 12069333, 'Para vitel toné, al horno o mechado.'],
  [1, 'Cuadrada', 21000, 500, 7163994, 'Para milanesas, bifes o a la portuguesa.'],
  [1, 'Bola de lomo', 22000, 500, 27743370, 'Ideal para guisos, estofados y milanesas.'],
  [1, 'Roast beef', 17500, 500, 33663495, 'Para el horno o la olla, cocción lenta.'],
  [1, 'Carne picada especial', 16000, 500, 128401, 'Picada en el momento, magra. Para empanadas, albóndigas y salsas.'],
  [2, 'Chorizo parrillero', 11500, 250, 28881687, 'Chorizo puro cerdo, hecho en casa.'],
  [2, 'Morcilla', 8500, 250, 31372367, 'Morcilla criolla para la parrilla.'],
  [2, 'Chinchulines', 9500, 250, 37297541, 'Limpios y listos para la parrilla, bien crocantes.'],
  [3, 'Bondiola de cerdo', 13500, 500, 9091138, 'Entera o en bifes, para la parrilla o al horno.'],
  [3, 'Pechito de cerdo', 9400, 500, 7163989, 'Costillitas de cerdo para la parrilla.'],
  [3, 'Pollo entero', 4950, 500, 10842249, 'Pollo fresco, entero o trozado.'],
  [3, 'Pechuga de pollo', 9500, 500, 6107731, 'Sin piel y sin hueso. Para milanesas o a la plancha.'],
];

// Lunes a sábado 8 a 13 y 17 a 21; domingo 9 a 13
const morning = { open: '08:00', close: '13:00' };
const afternoon = { open: '17:00', close: '21:00' };
const weeklySchedule = { 0: [{ open: '09:00', close: '13:00' }], 1: [morning, afternoon], 2: [morning, afternoon], 3: [morning, afternoon], 4: [morning, afternoon], 5: [morning, afternoon], 6: [morning, afternoon] };

const existing = await db.collection('comercios').where('name', '==', NAME).limit(1).get();
const ref = existing.empty ? db.collection('comercios').doc() : existing.docs[0].ref;
const store = {
  name: NAME,
  category: 'Carnicería',
  description: 'Cortes vacunos, cerdo, pollo y achuras. Elegís cuánto querés y lo cortamos en el momento.',
  logo: photo(18756768, 400),
  banner: photo(12884549, 1600),
  weeklySchedule,
  schedules: [morning, afternoon],
  daysOpen: [1, 2, 3, 4, 5, 6],
  // Muestra: oculta y sin dueño hasta que se le asigne uno
  ownerId: '',
  approvedByAdmin: true,
  isActive: false,
  isDemo: true,
};
if (existing.empty) {
  await ref.set({ ...store, createdAt: FieldValue.serverTimestamp(), createdBy: 'script:demo-carniceria-arias' });
  await ref.collection('private').doc('team').set({ ownerEmail: '', pendingOwnerEmail: '', members: [], updatedAt: FieldValue.serverTimestamp() });
} else {
  await ref.set({ ...store, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}

// Productos y rubros nuevos (se borran los de una corrida anterior)
for (const col of ['products', 'categories']) {
  const snap = await ref.collection(col).get();
  for (let i = 0; i < snap.docs.length; i += 400) {
    const b = db.batch();
    snap.docs.slice(i, i + 400).forEach((d) => b.delete(d.ref));
    await b.commit();
  }
}
const batch = db.batch();
const catIds = CATEGORIES.map((name, order) => {
  const c = ref.collection('categories').doc();
  batch.set(c, { name, order, isActive: true, createdAt: FieldValue.serverTimestamp() });
  return c.id;
});
CUTS.forEach(([cat, name, perKg, step, img, description], order) => {
  const p = ref.collection('products').doc();
  batch.set(p, {
    name, description, barcode: '',
    price: perKg, costPrice: 0,
    categoryId: catIds[cat],
    image: photo(img), imageUrl: photo(img),
    optionsGroups: [], isAvailable: true,
    stockMode: 'unlimited', stockQuantity: 0, stockThreshold: 0,
    useGlobalFlavors: false, maxSelections: 0, allowedFlavors: [],
    onlyInApp: false,
    soldByWeight: true, weightStep: step,
    order, createdAt: Timestamp.now(),
  });
});
await batch.commit();
console.log(JSON.stringify({ comercioId: ref.id, created: existing.empty, categories: catIds.length, products: CUTS.length }));
process.exit(0);
