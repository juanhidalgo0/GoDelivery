const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp({
    projectId: "godelivery-magdalena"
  });
}

const db = admin.firestore();

async function checkOffers() {
  try {
    const snap = await db.collection("offers").get();
    console.log(`[Check] Total offers in Firestore: ${snap.size}`);
    snap.docs.forEach(d => {
      console.log(`- Offer ID: ${d.id}, active: ${d.data().active}, comercioId: ${d.data().comercioId}, title: ${d.data().title}, badgeText: ${d.data().badgeText}`);
    });
  } catch (err) {
    console.error("Error fetching offers:", err);
  }
}

checkOffers();
