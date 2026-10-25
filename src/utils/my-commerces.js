// Los comercios a los que entra un usuario: los suyos (ownerId) y aquellos donde su correo
// tiene acceso de dueño (managerIds). Los accesos los maneja functions/commerce-access.js.
import { db, auth } from '../firebase.js';
import { collection, query, where, or, getDocs, limit } from 'firebase/firestore';
import { functionUrl } from './functions-url.js';

export function myCommercesQuery(uid) {
  return query(collection(db, 'comercios'), or(where('ownerId', '==', uid), where('managerIds', 'array-contains', uid)));
}

export function canManageCommerce(c, uid) {
  return !!c && !!uid && (c.ownerId === uid || (Array.isArray(c.managerIds) && c.managerIds.includes(uid)));
}

/** Acciones del servidor: create, setOwner, addMember, removeMember, claim */
export async function comercioAccess(action, payload = {}) {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Iniciá sesión de nuevo');
  const res = await fetch(functionUrl('comercioAccess'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'No se pudo guardar');
  return data;
}

/**
 * Si alguien invitó a este correo a un comercio (como dueño o con acceso), se aplica ahora.
 * Una lectura por inicio de sesión; la función solo se llama cuando hay algo para aplicar.
 */
export async function claimCommerceInvites(user) {
  const email = String(user?.email || '').trim().toLowerCase();
  if (!email) return [];
  const snap = await getDocs(query(collection(db, 'comercio_invites'), where('email', '==', email), limit(10)));
  if (snap.empty) return [];
  const { applied = [] } = await comercioAccess('claim');
  return applied;
}
