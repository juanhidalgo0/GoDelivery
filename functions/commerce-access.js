// Quién entra al panel de un comercio. Hay un dueño (comercios.ownerId) y, aparte, correos con
// el mismo acceso (comercios.managerIds): empleados o socios que entran con su propia cuenta,
// sin que el dueño tenga que prestar la suya.
//
// - El admin crea comercios, cambia el dueño y maneja los accesos.
// - El dueño suma y saca accesos de su comercio (los que tienen acceso no pueden sumar a otros).
// - Si el correo todavía no tiene cuenta en GO queda una invitación (comercio_invites) que se
//   aplica sola la primera vez que esa persona entra con ese correo (acción "claim").
//
// La lista con los correos vive en comercios/{id}/private/team (no en el doc público).

const { FieldValue } = require("firebase-admin/firestore");

class AccessError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const MAX_MEMBERS = 15;
const normEmail = (e) => String(e || "").trim().toLowerCase();
const isEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const inviteId = (cid, email) => `${cid}__${email.replace(/[^a-z0-9@._-]/g, "_")}`;

async function callerOf(db, decoded) {
  const snap = await db.collection("users").doc(decoded.uid).get();
  const u = snap.exists ? snap.data() : {};
  const isAdmin = decoded.email === "kioscopaulos7@gmail.com" || ["admin", "superadmin"].includes(u.role) || u.isAdmin === true;
  return { uid: decoded.uid, email: normEmail(decoded.email), emailVerified: decoded.email_verified === true, isAdmin };
}

/** Busca la cuenta de GO con ese correo (Auth primero; si no, el perfil de users) */
async function findUid(auth, db, email) {
  try {
    return (await auth.getUserByEmail(email)).uid;
  } catch (e) {
    if (e.code !== "auth/user-not-found") throw e;
  }
  const snap = await db.collection("users").where("email", "==", email).limit(1).get();
  return snap.empty ? null : snap.docs[0].id;
}

/** Marca al usuario como comercio sin pisarle otro rol (igual que src/utils/commerce-owner.js) */
async function grantRole(db, uid, comercioName, isOwner) {
  const ref = db.collection("users").doc(uid);
  const snap = await ref.get();
  const role = snap.exists ? snap.data().role : null;
  await ref.set({
    isComercio: true,
    commerceStatus: "approved",
    ...(!role || role === "user" || role === "cliente" ? { role: "comercio" } : {}),
  }, { merge: true });
  await ref.collection("notifications").add({
    type: "commerce_access",
    title: isOwner ? "🎉 Ya sos el dueño de un comercio en GO" : "🔑 Te dieron acceso a un comercio en GO",
    body: `Ya podés entrar al panel de "${comercioName || "tu comercio"}" desde Mi comercio.`,
    status: "unread",
    url: "/#/mi-comercio",
    createdAt: FieldValue.serverTimestamp(),
  }).catch(() => {});
}

async function loadComercio(db, cid) {
  if (!cid || typeof cid !== "string") throw new AccessError(400, "Falta el comercio");
  const ref = db.collection("comercios").doc(cid);
  const snap = await ref.get();
  if (!snap.exists) throw new AccessError(404, "Comercio no encontrado");
  return { ref, data: snap.data() };
}

async function readTeam(ref) {
  const snap = await ref.collection("private").doc("team").get();
  const t = snap.exists ? snap.data() : {};
  return { ownerEmail: t.ownerEmail || "", pendingOwnerEmail: t.pendingOwnerEmail || "", members: Array.isArray(t.members) ? t.members : [] };
}

async function writeTeam(ref, team) {
  await ref.collection("private").doc("team").set({ ...team, updatedAt: FieldValue.serverTimestamp() });
}

async function emailOfUid(auth, db, uid) {
  if (!uid) return "";
  try { return normEmail((await auth.getUser(uid)).email); } catch (e) { /* cuenta borrada */ }
  const snap = await db.collection("users").doc(uid).get();
  return snap.exists ? normEmail(snap.data().email) : "";
}

// ------------------------------------------------------------------ acciones

async function create(ctx, body) {
  if (!ctx.caller.isAdmin) throw new AccessError(403, "Solo el administrador crea comercios");
  const name = String(body.name || "").trim().slice(0, 80);
  if (name.length < 2) throw new AccessError(400, "Poné el nombre del comercio");
  const ref = ctx.db.collection("comercios").doc();
  await ref.set({
    name,
    category: String(body.category || "").trim().slice(0, 40) || null,
    ownerId: "",
    approvedByAdmin: true,
    // Oculto hasta que tenga logo, dirección y productos
    isActive: false,
    createdAt: FieldValue.serverTimestamp(),
    createdBy: ctx.caller.uid,
  });
  await writeTeam(ref, { ownerEmail: "", pendingOwnerEmail: "", members: [] });
  let owner = null;
  if (body.ownerEmail) owner = await setOwner(ctx, { comercioId: ref.id, email: body.ownerEmail });
  return { ok: true, comercioId: ref.id, owner };
}

async function setOwner(ctx, body) {
  if (!ctx.caller.isAdmin) throw new AccessError(403, "Solo el administrador cambia el dueño");
  const email = normEmail(body.email);
  if (!isEmail(email)) throw new AccessError(400, "El correo no es válido");
  const { ref, data } = await loadComercio(ctx.db, body.comercioId);
  const team = await readTeam(ref);
  const uid = await findUid(ctx.auth, ctx.db, email);
  // Invitación vieja de dueño para este comercio: se reemplaza
  if (team.pendingOwnerEmail && team.pendingOwnerEmail !== email) {
    await ctx.db.collection("comercio_invites").doc(inviteId(ref.id, team.pendingOwnerEmail)).delete().catch(() => {});
  }
  // Si el nuevo dueño estaba como acceso, deja de estarlo (ahora es el dueño)
  const members = team.members.filter((m) => m.email !== email);
  await ctx.db.collection("comercio_invites").doc(inviteId(ref.id, email)).delete().catch(() => {});
  if (uid) {
    await ref.update({ ownerId: uid, managerIds: FieldValue.arrayRemove(uid) });
    await writeTeam(ref, { ownerEmail: email, pendingOwnerEmail: "", members });
    await grantRole(ctx.db, uid, data.name, true);
    return { ok: true, pending: false, email };
  }
  // Sin cuenta todavía: el comercio queda sin dueño hasta que entre con ese correo
  await ref.update({ ownerId: "" });
  await ctx.db.collection("comercio_invites").doc(inviteId(ref.id, email)).set({
    comercioId: ref.id, comercioName: data.name || "", email, role: "owner",
    createdBy: ctx.caller.uid, createdAt: FieldValue.serverTimestamp(),
  });
  await writeTeam(ref, { ownerEmail: "", pendingOwnerEmail: email, members });
  return { ok: true, pending: true, email };
}

async function addMember(ctx, body) {
  const email = normEmail(body.email);
  if (!isEmail(email)) throw new AccessError(400, "El correo no es válido");
  const { ref, data } = await loadComercio(ctx.db, body.comercioId);
  if (!ctx.caller.isAdmin && data.ownerId !== ctx.caller.uid) throw new AccessError(403, "Solo el dueño puede dar accesos");
  const team = await readTeam(ref);
  const ownerEmail = team.ownerEmail || await emailOfUid(ctx.auth, ctx.db, data.ownerId);
  if (email === ownerEmail || email === team.pendingOwnerEmail) throw new AccessError(400, "Ese correo es el del dueño");
  if (team.members.some((m) => m.email === email)) throw new AccessError(409, "Ese correo ya tiene acceso");
  if (team.members.length >= MAX_MEMBERS) throw new AccessError(400, `Hasta ${MAX_MEMBERS} correos por comercio`);
  const uid = await findUid(ctx.auth, ctx.db, email);
  if (uid && uid === data.ownerId) throw new AccessError(400, "Ese correo es el del dueño");
  const member = { email, uid: uid || null, pending: !uid, addedBy: ctx.caller.uid, addedAt: Date.now() };
  if (uid) {
    await ref.update({ managerIds: FieldValue.arrayUnion(uid) });
    await grantRole(ctx.db, uid, data.name, false);
  } else {
    await ctx.db.collection("comercio_invites").doc(inviteId(ref.id, email)).set({
      comercioId: ref.id, comercioName: data.name || "", email, role: "member",
      createdBy: ctx.caller.uid, createdAt: FieldValue.serverTimestamp(),
    });
  }
  await writeTeam(ref, { ...team, ownerEmail, members: [...team.members, member] });
  return { ok: true, pending: !uid, email };
}

async function removeMember(ctx, body) {
  const email = normEmail(body.email);
  const { ref, data } = await loadComercio(ctx.db, body.comercioId);
  const team = await readTeam(ref);
  const member = team.members.find((m) => m.email === email);
  // Quien tiene acceso puede irse solo; sacar a otros, el dueño o el admin
  const isSelf = member && member.uid && member.uid === ctx.caller.uid;
  if (!ctx.caller.isAdmin && data.ownerId !== ctx.caller.uid && !isSelf) throw new AccessError(403, "Solo el dueño puede sacar accesos");
  if (!member) throw new AccessError(404, "Ese correo no tiene acceso");
  if (member.uid) await ref.update({ managerIds: FieldValue.arrayRemove(member.uid) });
  await ctx.db.collection("comercio_invites").doc(inviteId(ref.id, email)).delete().catch(() => {});
  await writeTeam(ref, { ...team, members: team.members.filter((m) => m.email !== email) });
  return { ok: true };
}

/** Aplica las invitaciones pendientes del correo con el que entró el usuario */
async function claim(ctx) {
  const { email, emailVerified, uid } = ctx.caller;
  if (!email) return { ok: true, applied: [] };
  // Google siempre trae el correo verificado; con correo y clave hay que verificarlo antes
  if (!emailVerified) throw new AccessError(403, "Verificá tu correo para entrar al comercio");
  const snap = await ctx.db.collection("comercio_invites").where("email", "==", email).get();
  const applied = [];
  for (const inv of snap.docs) {
    const i = inv.data();
    const ref = ctx.db.collection("comercios").doc(i.comercioId);
    const c = await ref.get();
    if (!c.exists) { await inv.ref.delete(); continue; }
    const team = await readTeam(ref);
    if (i.role === "owner") {
      if (team.pendingOwnerEmail !== email) { await inv.ref.delete(); continue; }
      await ref.update({ ownerId: uid, managerIds: FieldValue.arrayRemove(uid) });
      await writeTeam(ref, { ...team, ownerEmail: email, pendingOwnerEmail: "" });
    } else {
      if (!team.members.some((m) => m.email === email)) { await inv.ref.delete(); continue; }
      await ref.update({ managerIds: FieldValue.arrayUnion(uid) });
      await writeTeam(ref, { ...team, members: team.members.map((m) => (m.email === email ? { ...m, uid, pending: false } : m)) });
    }
    await grantRole(ctx.db, uid, c.data().name, i.role === "owner");
    await inv.ref.delete();
    applied.push({ comercioId: i.comercioId, role: i.role });
  }
  return { ok: true, applied };
}

const ACTIONS = { create, setOwner, addMember, removeMember, claim };

async function handle({ db, auth, decoded, body }) {
  const fn = ACTIONS[body && body.action];
  if (!fn) throw new AccessError(400, "Acción desconocida");
  const caller = await callerOf(db, decoded);
  return fn({ db, auth, caller }, body);
}

module.exports = { handle, AccessError, normEmail, inviteId };
