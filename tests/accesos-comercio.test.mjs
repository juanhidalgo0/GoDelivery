// Dueño y personas con acceso a un comercio (functions/commerce-access.js), contra los emuladores:
//
//   npx firebase-tools emulators:exec --config firebase.e2e.json --project demo-godelivery \
//     --only auth,firestore,functions "node tests/accesos-comercio.test.mjs"
//
// El admin crea un comercio con un dueño que todavía no tiene cuenta; el dueño entra y queda
// asignado; suma un empleado con cuenta y otro sin cuenta; el empleado no puede sumar a otros;
// se cambia el dueño; sacar un acceso lo deja afuera.

import { createRequire } from 'module';
import assert from 'assert';

const require = createRequire(new URL('../functions/package.json', import.meta.url));
const admin = require('firebase-admin');
process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
const PROJECT = process.env.GCLOUD_PROJECT || 'demo-godelivery';
if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
const db = admin.firestore();
const auth = admin.auth();
const FN = `http://127.0.0.1:5001/${PROJECT}/us-central1`;
const { Timestamp } = require('firebase-admin/firestore');

let ok = 0, bad = 0;
const t = async (name, fn) => { try { await fn(); ok++; console.log(`ok    ${name}`); } catch (e) { bad++; console.log(`FALLA ${name}\n      ${e.stack || e.message}`); } };

// Cuenta del emulador. verified: como entrar con Google (el correo viene verificado).
async function account(email, data = {}, verified = true) {
  const password = 'acceso-' + email.length + '-123';
  let u;
  try { u = await auth.getUserByEmail(email); } catch { u = await auth.createUser({ email, password, displayName: data.displayName }); }
  await auth.updateUser(u.uid, { emailVerified: verified });
  await db.doc(`users/${u.uid}`).set({ email, createdAt: Timestamp.now(), role: 'user', ...data }, { merge: true });
  const r = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  return { uid: u.uid, email, token: (await r.json()).idToken };
}
const call = async (who, body) => {
  const r = await fetch(`${FN}/comercioAccess`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${who.token}` }, body: JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch { /* sin cuerpo */ }
  return { status: r.status, body: j };
};
const com = async (id) => (await db.doc(`comercios/${id}`).get()).data();
const team = async (id) => (await db.doc(`comercios/${id}/private/team`).get()).data();

const stamp = Date.now().toString(36);
const jefe = await account('kioscopaulos7@gmail.com', { role: 'admin', isAdmin: true });
const cualquiera = await account(`cualquiera.${stamp}@e2e.test`);
const empleado = await account(`empleado.${stamp}@e2e.test`, { displayName: 'Empleado' });
const repartidor = await account(`repa.${stamp}@e2e.test`, { role: 'delivery', isDelivery: true });
const DUENO = `dueno.${stamp}@e2e.test`;
const NUEVO = `nuevo.${stamp}@e2e.test`;
let CID = '';
let dueno = null;

await t('solo el admin crea comercios', async () => {
  const r = await call(cualquiera, { action: 'create', name: 'Trucho' });
  assert.strictEqual(r.status, 403);
});
await t('admin crea un comercio con un dueño que todavía no tiene cuenta', async () => {
  const r = await call(jefe, { action: 'create', name: 'Kiosco Equipo', ownerEmail: DUENO.toUpperCase() });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  CID = r.body.comercioId;
  assert.strictEqual(r.body.owner.pending, true);
  const c = await com(CID);
  assert.strictEqual(c.ownerId, '');
  assert.strictEqual(c.isActive, false, 'nace oculto');
  assert.strictEqual((await team(CID)).pendingOwnerEmail, DUENO, 'correo en minúsculas');
  const inv = await db.collection('comercio_invites').where('email', '==', DUENO).get();
  assert.strictEqual(inv.size, 1);
});
await t('con correo sin verificar no se toma la invitación', async () => {
  const sinVerificar = await account(DUENO, {}, false);
  const r = await call(sinVerificar, { action: 'claim' });
  assert.strictEqual(r.status, 403);
  assert.strictEqual((await com(CID)).ownerId, '');
});
await t('el dueño entra con ese correo y queda asignado', async () => {
  dueno = await account(DUENO, { displayName: 'Dueño' }, true);
  const r = await call(dueno, { action: 'claim' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.deepStrictEqual(r.body.applied, [{ comercioId: CID, role: 'owner' }]);
  assert.strictEqual((await com(CID)).ownerId, dueno.uid);
  const u = (await db.doc(`users/${dueno.uid}`).get()).data();
  assert.strictEqual(u.isComercio, true);
  assert.strictEqual(u.role, 'comercio');
  assert.strictEqual((await team(CID)).ownerEmail, DUENO);
  assert.strictEqual((await db.collection('comercio_invites').where('email', '==', DUENO).get()).size, 0, 'la invitación se usa una vez');
});
await t('el dueño da acceso a un correo con cuenta: entra en el momento', async () => {
  const r = await call(dueno, { action: 'addMember', comercioId: CID, email: empleado.email });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.pending, false);
  assert.deepStrictEqual((await com(CID)).managerIds, [empleado.uid]);
  assert.strictEqual((await db.doc(`users/${empleado.uid}`).get()).data().isComercio, true);
});
await t('a un repartidor se le da acceso sin perder su rol', async () => {
  const r = await call(dueno, { action: 'addMember', comercioId: CID, email: repartidor.email });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const u = (await db.doc(`users/${repartidor.uid}`).get()).data();
  assert.strictEqual(u.role, 'delivery');
  assert.strictEqual(u.isComercio, true);
});
await t('no se repite un correo ni se agrega el del dueño', async () => {
  assert.strictEqual((await call(dueno, { action: 'addMember', comercioId: CID, email: empleado.email })).status, 409);
  assert.strictEqual((await call(dueno, { action: 'addMember', comercioId: CID, email: DUENO })).status, 400);
  assert.strictEqual((await call(dueno, { action: 'addMember', comercioId: CID, email: 'no-es-correo' })).status, 400);
});
await t('quien tiene acceso NO puede sumar a otros ni cambiar el dueño', async () => {
  assert.strictEqual((await call(empleado, { action: 'addMember', comercioId: CID, email: cualquiera.email })).status, 403);
  assert.strictEqual((await call(empleado, { action: 'setOwner', comercioId: CID, email: empleado.email })).status, 403);
  assert.strictEqual((await call(dueno, { action: 'setOwner', comercioId: CID, email: cualquiera.email })).status, 403, 'el dueño tampoco: lo hace el admin');
  assert.strictEqual((await call(cualquiera, { action: 'removeMember', comercioId: CID, email: empleado.email })).status, 403);
});
await t('un correo sin cuenta queda invitado y entra cuando se registra', async () => {
  const r = await call(dueno, { action: 'addMember', comercioId: CID, email: NUEVO });
  assert.strictEqual(r.body.pending, true);
  const m = (await team(CID)).members.find((x) => x.email === NUEVO);
  assert.strictEqual(m.pending, true);
  const nuevo = await account(NUEVO, {}, true);
  const c = await call(nuevo, { action: 'claim' });
  assert.deepStrictEqual(c.body.applied, [{ comercioId: CID, role: 'member' }]);
  assert.ok((await com(CID)).managerIds.includes(nuevo.uid));
  assert.strictEqual((await team(CID)).members.find((x) => x.email === NUEVO).pending, false);
});
await t('sacar un acceso lo deja afuera', async () => {
  const r = await call(dueno, { action: 'removeMember', comercioId: CID, email: empleado.email });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.ok(!(await com(CID)).managerIds.includes(empleado.uid));
  assert.ok(!(await team(CID)).members.some((x) => x.email === empleado.email));
});
await t('quien tiene acceso puede irse solo', async () => {
  const r = await call(repartidor, { action: 'removeMember', comercioId: CID, email: repartidor.email });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.ok(!(await com(CID)).managerIds.includes(repartidor.uid));
});
await t('admin cambia el dueño por un correo con acceso: deja de ser acceso y pasa a dueño', async () => {
  const nuevo = await account(NUEVO, {}, true);
  const r = await call(jefe, { action: 'setOwner', comercioId: CID, email: NUEVO });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const c = await com(CID);
  assert.strictEqual(c.ownerId, nuevo.uid);
  assert.ok(!c.managerIds.includes(nuevo.uid));
  const tm = await team(CID);
  assert.strictEqual(tm.ownerEmail, NUEVO);
  assert.ok(!tm.members.some((x) => x.email === NUEVO));
  // El dueño anterior ya no puede dar accesos
  assert.strictEqual((await call(dueno, { action: 'addMember', comercioId: CID, email: cualquiera.email })).status, 403);
});
await t('admin cambia el dueño por un correo sin cuenta: queda pendiente y la invitación vieja se borra', async () => {
  const otro = `otro.${stamp}@e2e.test`;
  const otro2 = `otro2.${stamp}@e2e.test`;
  await call(jefe, { action: 'setOwner', comercioId: CID, email: otro });
  await call(jefe, { action: 'setOwner', comercioId: CID, email: otro2 });
  assert.strictEqual((await com(CID)).ownerId, '');
  assert.strictEqual((await team(CID)).pendingOwnerEmail, otro2);
  assert.strictEqual((await db.collection('comercio_invites').where('email', '==', otro).get()).size, 0);
  assert.strictEqual((await db.collection('comercio_invites').where('email', '==', otro2).get()).size, 1);
});
await t('sin acción o sin sesión no hace nada', async () => {
  assert.strictEqual((await call(jefe, { action: 'borrarTodo' })).status, 400);
  const r = await fetch(`${FN}/comercioAccess`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.strictEqual(r.status, 401);
});

console.log(`\n${ok} bien, ${bad} con falla`);
process.exit(bad ? 1 : 0);
