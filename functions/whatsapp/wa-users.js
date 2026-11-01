// El cliente de WhatsApp sin cuenta en la app tiene su usuario: users/{número} (el mismo userId que
// llevan sus pedidos). Con él suma GoPoints al completar pedidos (onOrderStatusChange los da solo si
// existe el doc), el cadete y el admin lo ven como cliente, y el link de seguimiento abre su sesión.
const { FieldValue } = require("firebase-admin/firestore");

async function ensureWaUser(db, { userId, userName, userPhone, waPhone }) {
  if (!userId || String(userId) !== String(waPhone)) return; // tiene cuenta en la app: es esa
  const ref = db.collection("users").doc(String(userId));
  const snap = await ref.get();
  if (snap.exists) {
    if (snap.data().isWhatsAppClient !== true) await ref.set({ isWhatsAppClient: true }, { merge: true });
    return;
  }
  await ref.set({
    displayName: userName || "Cliente WhatsApp",
    phone: userPhone || "",
    role: "user",
    isWhatsAppClient: true,
    waPhone: String(waPhone),
    points: 0,
    completedOrdersCount: 0,
    onboardingCompleted: true,
    createdVia: "whatsapp_bot",
    createdAt: FieldValue.serverTimestamp(),
  });
}

module.exports = { ensureWaUser };
