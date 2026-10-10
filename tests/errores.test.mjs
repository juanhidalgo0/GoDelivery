// Detector de errores: functions/client-errors.js (función real) + reglas de client_errors.
//
//   FUNCTIONS_DISCOVERY_TIMEOUT=90 npx firebase-tools emulators:exec --only functions,firestore --project demo-godelivery "node tests/errores.test.mjs"
//
// Manda errores como los manda la app (src/utils/error-reporter.js) y revisa que se agrupen, que
// cuenten personas, que avisen cuando corresponde (nuevo, volvió, repetido) y no con los de red.

import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, collection, getDocs } from 'firebase/firestore';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = process.env.GCLOUD_PROJECT || 'demo-godelivery';
const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
const env = await initializeTestEnvironment({
  projectId: PROJECT,
  firestore: { host, port: Number(port), rules: fs.readFileSync(path.join(HERE, '..', 'firestore.rules'), 'utf8') },
});
const URL = `http://127.0.0.1:5001/${PROJECT}/us-central1/reportClientError`;

let pass = 0, fail = 0;
function check(label, ok, detail = '') {
  if (ok) { pass++; console.log('  OK   ' + label); }
  else { fail++; console.log('  FALLO ' + label + (detail ? '  → ' + detail : '')); }
}
async function throws(fn) { try { await fn(); return false; } catch { return true; } }

async function asAdmin(fn) {
  let out;
  await env.withSecurityRulesDisabled(async (ctx) => { out = await fn(ctx.firestore()); });
  return out;
}
const allErrors = () => asAdmin(async (db) => (await getDocs(collection(db, 'client_errors'))).docs.map((d) => ({ id: d.id, ...d.data() })));
const alertsSent = () => asAdmin(async (db) => (await getDoc(doc(db, 'system/client_errors_alerts'))).data()?.sent || 0);

// Como la app: cada aparición con su pila (la del build cambia de hash y de línea entre deploys)
const stackAt = (build, line) => `TypeError: x\n    at guardar (https://godelivery-magdalena.web.app/assets/cart-${build}.js:${line}:12)\n    at HTMLButtonElement.onclick (https://godelivery-magdalena.web.app/assets/cart-${build}.js:900:3)`;
async function report(errors, extra = {}) {
  const res = await fetch(URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ errors, ...extra }) });
  return res.status;
}
const err = (over = {}) => ({ kind: 'error', message: "Cannot read properties of undefined (reading 'precio')", stack: stackAt('Ab12cD34', 120), route: '#/cart', role: 'user', version: '1791472600218', platform: 'app android', ...over });

await env.clearFirestore();
await asAdmin(async (db) => {
  await setDoc(doc(db, 'users/jefe'), { role: 'admin', isAdmin: true });
  await setDoc(doc(db, 'users/cliente'), { role: 'user' });
});

console.log('=========== AGRUPAR ===========');
check('acepta un error de la app', (await report([err()])) === 200);
let list = await allErrors();
check('queda un grupo abierto', list.length === 1 && list[0].status === 'open' && list[0].count === 1, JSON.stringify(list));
check('error nuevo → aviso a los admins', (await alertsSent()) === 1);

await report([err({ stack: stackAt('Zz98yY76', 133), route: '#/cart?x=1', version: '1791999999999' })]);
list = await allErrors();
check('el mismo error con otro build y otra línea cae en el mismo grupo', list.length === 1 && list[0].count === 2, JSON.stringify(list.map((e) => e.count)));
check('...cuenta pantallas y versiones por separado', Object.keys(list[0].versions || {}).length === 2);
check('...y no vuelve a avisar', (await alertsSent()) === 1);

await report([err({ message: "Cannot read properties of undefined (reading 'total')" })]);
check('otra propiedad en el mismo lugar es otro error', (await allErrors()).length === 2);

await report([err({ message: 'Error al guardar el pedido 4821 de AbCdEfGhIjKlMnOpQrSt', kind: 'capturado' }), err({ message: 'Error al guardar el pedido 977 de ZyXwVuTsRqPoNmLkJiHg', kind: 'capturado' })]);
const captured = (await allErrors()).filter((e) => e.kind === 'capturado');
check('números e ids distintos no parten el grupo', captured.length === 1 && captured[0].count === 2, JSON.stringify(captured.map((e) => e.count)));
check('un error atrapado (console.error) nuevo no avisa: sólo si se repite', (await alertsSent()) === 2);

const beforeToast = await alertsSent();
await report([err({ kind: 'toast', message: 'No se pudo guardar el pedido', stack: 'Error\n    at showToast (https://x/assets/toast-Ab12cD34.js:1:1)\n    at guardar (https://x/assets/cart-Ab12cD34.js:5:5)' })]);
const toast = (await allErrors()).find((e) => e.kind === 'toast');
check('un mensaje de error al usuario se anota', !!toast && toast.message === 'No se pudo guardar el pedido');
check('...con el lugar desde donde se mostró (no el toast)', toast?.frame === 'at guardar (/assets/cart.js)', toast?.frame);
check('...sin avisar', (await alertsSent()) === beforeToast);

console.log('=========== RED Y RUIDO ===========');
await report([err({ kind: 'promesa', message: 'TypeError: Failed to fetch' })]);
const net = (await allErrors()).find((e) => e.network);
check('los errores de red se anotan marcados como red', !!net && net.message.includes('Failed to fetch'));
check('...y no avisan', (await alertsSent()) === 2);
await report([err({ message: 'ResizeObserver loop completed with undelivered notifications.' }), err({ message: 'Script error.' })]);
check('el ruido del navegador ni se guarda', !(await allErrors()).some((e) => /ResizeObserver|Script error/.test(e.message)));
check('rechaza lo que no es POST', (await fetch(URL)).status === 405);

console.log('=========== PERSONAS, RESUELTO Y REPETIDO ===========');
const precio = (await allErrors()).find((e) => e.message.includes("'precio'"));
await report([err()], { idToken: 'token-trucho' });
check('con un token inválido se registra igual, sin persona', ((await allErrors()).find((e) => e.id === precio.id)).userCount === 0);

const jefe = env.authenticatedContext('jefe').firestore();
const cliente = env.authenticatedContext('cliente').firestore();
check('un cliente no puede leer los errores', await throws(() => getDoc(doc(cliente, 'client_errors', precio.id))));
check('ni crearlos', await throws(() => setDoc(doc(cliente, 'client_errors', 'falso'), { message: 'x', status: 'open' })));
check('el admin los lee', !(await throws(() => getDoc(doc(jefe, 'client_errors', precio.id)))));
check('el admin no puede tocar el contador', await throws(() => updateDoc(doc(jefe, 'client_errors', precio.id), { count: 0 })));
check('el admin lo marca resuelto', !(await throws(() => updateDoc(doc(jefe, 'client_errors', precio.id), { status: 'resolved', statusBy: 'jefe', statusAt: new Date() }))));

const before = await alertsSent();
await report([err()]);
const back = (await allErrors()).find((e) => e.id === precio.id);
check('si vuelve a pasar se reabre solo', back.status === 'open' && back.reopenCount === 1, JSON.stringify({ s: back.status, r: back.reopenCount }));
check('...y avisa que volvió', (await alertsSent()) === before + 1);

await updateDoc(doc(jefe, 'client_errors', precio.id), { status: 'ignored' });
await report([err()]);
const ign = (await allErrors()).find((e) => e.id === precio.id);
check('uno ignorado sigue contando pero no se reabre', ign.status === 'ignored' && ign.count === back.count + 1);
await updateDoc(doc(jefe, 'client_errors', precio.id), { status: 'open' });

// Hasta 10 veces: al llegar a 10 avisa que se repite (el tope es 6 avisos por hora)
const cur = (await allErrors()).find((e) => e.id === precio.id).count;
const sentBefore = await alertsSent();
for (let i = cur; i < 10; i++) await report([err()]);
check('al llegar a 10 veces avisa que se repite', ((await allErrors()).find((e) => e.id === precio.id)).count === 10 && (await alertsSent()) === sentBefore + 1);

console.log('=========== TOPE DE AVISOS ===========');
for (let i = 0; i < 8; i++) await report([err({ message: `Error distinto número ${'abcdefghij'[i]} en checkout` })]);
check('no manda más de 6 avisos por hora aunque aparezcan muchos errores nuevos', (await alertsSent()) === 6, String(await alertsSent()));

console.log('================================================');
console.log(`  PASARON: ${pass}   |   FALLARON: ${fail}`);
console.log('================================================');
await env.cleanup();
process.exit(fail ? 1 : 0);
