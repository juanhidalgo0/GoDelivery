// Dueño de un comercio: darle el rol, asignarlo y encontrar candidatos.
// Lo usan la aprobación de solicitudes y el editor de comercios del admin.
import { db } from '../firebase.js';
import { doc, getDoc, updateDoc, addDoc, collection, getDocs, query, where, serverTimestamp } from 'firebase/firestore';

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// Marca al usuario como comercio sin pisarle otro rol (un admin o un cadete siguen siéndolo).
export async function grantCommerceRole(uid, comercioName = '') {
  const ref = doc(db, 'users', uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('user-not-found');
  const role = snap.data().role;
  await updateDoc(ref, {
    isComercio: true,
    commerceStatus: 'approved',
    ...(!role || role === 'user' ? { role: 'comercio' } : {}),
  });
  await addDoc(collection(db, 'users', uid, 'notifications'), {
    type: 'commerce_approved',
    title: '🎉 ¡Tu comercio ya está en GO!',
    body: comercioName ? `Ya podés entrar al panel de "${comercioName}" desde Mi comercio.` : 'Ya podés entrar a tu panel desde Mi comercio.',
    status: 'unread',
    url: '/#/mi-comercio',
    createdAt: serverTimestamp(),
  }).catch(() => {});
}

export async function assignCommerceOwner(comercioId, uid, comercioName = '') {
  await updateDoc(doc(db, 'comercios', comercioId), { ownerId: uid });
  await grantCommerceRole(uid, comercioName);
}

export async function getUserSummary(uid) {
  if (!uid) return null;
  const snap = await getDoc(doc(db, 'users', uid));
  if (!snap.exists()) return null;
  const u = snap.data();
  return { uid, name: u.displayName || u.name || '', email: u.email || '', phone: u.phone || '', role: u.role || 'user' };
}

export async function findUserByEmail(email) {
  const snap = await getDocs(query(collection(db, 'users'), where('email', '==', String(email).trim().toLowerCase())));
  if (!snap.empty) return getUserSummary(snap.docs[0].id);
  // Hay cuentas viejas con mayúsculas en el mail
  const raw = await getDocs(query(collection(db, 'users'), where('email', '==', String(email).trim())));
  return raw.empty ? null : getUserSummary(raw.docs[0].id);
}

// Usuarios que pidieron dar de alta un comercio con un nombre parecido: los dueños más probables.
// Se puede pasar la lista ya leída (loadOwnerApplicants) para revisar muchos comercios con una sola consulta.
export async function loadOwnerApplicants() {
  const snap = await getDocs(query(collection(db, 'users'), where('commerceStatus', 'in', ['pending', 'approved', 'rejected'])));
  return snap.docs.map(d => ({ uid: d.id, ...d.data() }));
}

export async function findOwnerCandidates(comercioName, applicants = null) {
  const target = norm(comercioName);
  if (!target) return [];
  const users = applicants || await loadOwnerApplicants();
  const words = target.split(' ').filter(w => w.length > 2);
  return users
    .map(u => {
      const app = norm(u.commerceApplication?.name);
      const score = !app ? 0 : app === target ? 3 : (app.includes(target) || target.includes(app)) ? 2 : words.some(w => app.includes(w)) ? 1 : 0;
      return { uid: u.uid, name: u.displayName || u.name || '', email: u.email || '', phone: u.phone || u.commerceApplication?.phone || '', applicationName: u.commerceApplication?.name || '', status: u.commerceStatus, score };
    })
    .filter(u => u.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
}
