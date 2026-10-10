// Arreglos de una sola vez que corre el admin desde Comercios (28-09-2026):
//  1. Los comercios usan GO! gratis: la comisión pendiente de todos los pedidos pasa a 0.
//     Cada pedido guarda lo que debía en commissionAmountOriginal, por si hay que volver atrás.
//  2. El cupón de bienvenida (BIENVENIDA, $3.000) deja de existir.
//  3. Dueños de comercios aprobados que nunca recibieron el rol (la aprobación fallaba en silencio).
//  4. Comercios sin dueño: si un único usuario pidió el alta con ese nombre, se lo asigna.
import { db } from '../../firebase.js';
import { collection, getDocs, getDoc, doc, writeBatch, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { grantCommerceRole, assignCommerceOwner, findOwnerCandidates } from '../../utils/commerce-owner.js';

const WELCOME_COUPON = 'BIENVENIDA';

const isWaivable = (o) =>
  Number(o.commissionAmount) > 0 && o.commissionStatus !== 'paid' && o.isSettled !== true;

async function ownersWithoutRole() {
  const comercios = await getDocs(collection(db, 'comercios'));
  const approved = comercios.docs.map(d => ({ id: d.id, ...d.data() })).filter(c => c.ownerId && c.approvedByAdmin !== false);
  const out = [];
  for (const c of approved) {
    const u = await getDoc(doc(db, 'users', c.ownerId));
    if (!u.exists()) continue;
    const d = u.data();
    const ok = d.isComercio === true || ['comercio', 'admin', 'superadmin'].includes(d.role);
    if (!ok) out.push({ uid: c.ownerId, comercioName: c.name || '' });
  }
  return out;
}

export async function grantMissingOwnerRoles() {
  const list = await ownersWithoutRole();
  for (const o of list) await grantCommerceRole(o.uid, o.comercioName);
  return list.length;
}

// Sin dueño: con un candidato claro (mismo nombre, o el único parecido) se propone; si no, queda a mano.
async function ownerlessComercios() {
  const comercios = await getDocs(collection(db, 'comercios'));
  const out = [];
  for (const d of comercios.docs) {
    const c = d.data();
    if (c.ownerId) continue;
    const n = (c.name || '').toLowerCase();
    if (n.includes('go!') && n.includes('market')) continue; // la tienda propia de GO!
    const cands = await findOwnerCandidates(c.name).catch(() => []);
    const best = cands.filter(x => x.score === cands[0]?.score);
    const match = cands.length && best.length === 1 && (cands[0].score >= 2 || cands.length === 1) ? cands[0] : null;
    out.push({ id: d.id, name: c.name || '', match });
  }
  return out;
}

export async function assignMatchedOwners() {
  const list = (await ownerlessComercios()).filter(c => c.match);
  for (const c of list) await assignCommerceOwner(c.id, c.match.uid, c.name);
  return list.length;
}

export async function scanCommerceFixes() {
  const [ordersSnap, couponSnap, missingRoles, ownerless] = await Promise.all([
    getDocs(collection(db, 'orders')),
    getDoc(doc(db, 'coupons', WELCOME_COUPON)),
    ownersWithoutRole(),
    ownerlessComercios(),
  ]);
  const pending = ordersSnap.docs.filter(d => isWaivable(d.data()));
  return {
    ownerMatches: ownerless.filter(c => c.match),
    ownerlessUnmatched: ownerless.filter(c => !c.match).map(c => c.name),
    ownersWithoutRole: missingRoles.length,
    ownerNames: missingRoles.map(o => o.comercioName),
    orders: pending.length,
    total: pending.reduce((s, d) => s + Number(d.data().commissionAmount || 0), 0),
    comercios: new Set(pending.map(d => d.data().comercioId)).size,
    welcomeCouponExists: couponSnap.exists(),
  };
}

export async function waiveAllCommerceCommissions() {
  const snap = await getDocs(collection(db, 'orders'));
  const targets = snap.docs.filter(d => isWaivable(d.data()));
  for (let i = 0; i < targets.length; i += 400) {
    const batch = writeBatch(db);
    targets.slice(i, i + 400).forEach(d => batch.update(d.ref, {
      commissionAmountOriginal: Number(d.data().commissionAmount) || 0,
      commissionAmount: 0,
      commissionStatus: 'waived',
      commissionWaivedAt: serverTimestamp(),
    }));
    await batch.commit();
  }
  return targets.length;
}

export async function deleteWelcomeCoupon() {
  const redemptions = await getDocs(collection(db, 'coupons', WELCOME_COUPON, 'redemptions'));
  for (let i = 0; i < redemptions.docs.length; i += 400) {
    const batch = writeBatch(db);
    redemptions.docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
  await deleteDoc(doc(db, 'coupons', WELCOME_COUPON));
}
