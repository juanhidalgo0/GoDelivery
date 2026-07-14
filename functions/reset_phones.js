const admin = require("firebase-admin");

// Initialize Firebase Admin pointing to the project ID
admin.initializeApp({
  projectId: "godelivery-magdalena"
});
const db = admin.firestore();

async function reset() {
  console.log("Obteniendo usuarios de Firestore...");
  const usersSnap = await db.collection("users").get();
  console.log(`Encontrados ${usersSnap.size} usuarios.`);
  
  if (usersSnap.size === 0) {
    console.log("No hay usuarios registrados para actualizar.");
    return;
  }

  const batch = db.batch();
  usersSnap.forEach(doc => {
    console.log(`Preparando reset para usuario: ${doc.id}`);
    batch.update(doc.ref, {
      phoneVerified: false
    });
  });
  
  await batch.commit();
  console.log("¡Todos los usuarios han sido actualizados con éxito!");
}

reset().catch(error => {
  console.error("Error al resetear los teléfonos:", error);
});
