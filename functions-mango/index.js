// ═══════════════════════════════════════════════════
// MANGO POS — SAAS BILLING (accounts + subscriptions)
//
// Codebase propio ("mango"), separado de las funciones de GoDelivery:
// tiene su propia colección (ventra_accounts) y su propio secreto de
// Mercado Pago. Así un deploy de GoDelivery nunca depende de Mango.
//
// Deploy:  firebase deploy --only functions:mango
// Requiere antes:  firebase functions:secrets:set VENTRA_MP_ACCESS_TOKEN
// ═══════════════════════════════════════════════════
const { onRequest } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const { MercadoPagoConfig, PreApproval } = require("mercadopago");

setGlobalOptions({ maxInstances: 20, memory: "512Mi", region: "us-central1" });

admin.initializeApp();
const db = admin.firestore();

const VENTRA_MP_ACCESS_TOKEN = defineSecret("VENTRA_MP_ACCESS_TOKEN");

const VENTRA_PLANS = {
  caja: { name: "Mango Caja", amount: 14900 },
  full: { name: "Mango Full", amount: 24900 },
  tienda: { name: "Mango Tienda", amount: 9900 },
};

// Called from the landing page once the user is signed in with Google and
// picks a plan. Creates (or updates) their account doc and a Mercado Pago
// recurring subscription (PreApproval), returning the checkout URL to
// redirect the browser to.
exports.createVentraSubscription = onRequest({ cors: true, secrets: [VENTRA_MP_ACCESS_TOKEN] }, async (req, res) => {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");
  const { uid, email, plan } = req.body || {};
  const planInfo = VENTRA_PLANS[plan];
  if (!uid || !email || !planInfo) {
    return res.status(400).json({ error: "Faltan datos (uid, email, plan válido)" });
  }

  try {
    const client = new MercadoPagoConfig({ accessToken: VENTRA_MP_ACCESS_TOKEN.value() });
    const preapproval = new PreApproval(client);
    const response = await preapproval.create({
      body: {
        reason: `Suscripción ${planInfo.name} — Mango POS`,
        external_reference: uid,
        payer_email: email,
        back_url: "https://mangoapp.online/cuenta.html",
        auto_recurring: {
          frequency: 1,
          frequency_type: "months",
          transaction_amount: planInfo.amount,
          currency_id: "ARS",
        },
        status: "pending",
      },
    });

    await db.collection("ventra_accounts").doc(uid).set({
      email,
      plan,
      planName: planInfo.name,
      status: "pending_payment",
      mpPreapprovalId: response.id,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    res.status(200).json({ initPoint: response.init_point });
  } catch (err) {
    logger.error("Mango: error creating subscription:", err);
    res.status(500).json({ error: "No se pudo iniciar la suscripción" });
  }
});

// Mercado Pago calls this whenever a Mango subscription's status changes
// (authorized, paused, cancelled...). We look up the real status via the API
// (never trust the webhook payload directly) and mirror it onto the account.
exports.ventraMercadopagoWebhook = onRequest({ secrets: [VENTRA_MP_ACCESS_TOKEN] }, async (req, res) => {
  const { query, body } = req;
  const type = query.type || (body && body.type);
  const preapprovalId = query["data.id"] || (body && body.data && body.data.id);

  if (type === "subscription_preapproval" && preapprovalId) {
    try {
      const client = new MercadoPagoConfig({ accessToken: VENTRA_MP_ACCESS_TOKEN.value() });
      const preapproval = new PreApproval(client);
      const sub = await preapproval.get({ id: preapprovalId });

      const uid = sub.external_reference;
      if (uid) {
        await db.collection("ventra_accounts").doc(uid).set({
          status: sub.status === "authorized" ? "active" : sub.status,
          mpPreapprovalId: preapprovalId,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        logger.info(`Mango: account ${uid} subscription status -> ${sub.status}`);
      }
    } catch (err) {
      logger.error("Mango: webhook processing error:", err);
    }
  }

  res.status(200).send("OK");
});
