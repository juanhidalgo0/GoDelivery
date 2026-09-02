import { initAuthCreds, BufferJSON } from '@whiskeysockets/baileys';

/**
 * Adaptador de autenticación Baileys para Firebase Firestore.
 * Permite guardar las credenciales criptográficas y claves de sesión en la nube,
 * de modo que cualquier contenedor (Render, Koyeb, Railway) se reconecte en 2 segundos
 * sin depender de un disco duro local ni requerir escanear el QR cada vez que reinicia.
 */
export async function useFirestoreAuthState(db, sessionName = 'godelivery_main_bot') {
  const sessionRef = db.collection('whatsapp_bot_sessions').doc(sessionName);
  const credsDocRef = sessionRef.collection('data').doc('creds');
  const keysColRef = sessionRef.collection('keys');

  // 1. Read existing creds from Firestore or initialize new ones
  let creds;
  try {
    const credsSnap = await credsDocRef.get();
    if (credsSnap.exists) {
      const data = credsSnap.data();
      creds = JSON.parse(data.json, BufferJSON.reviver);
      console.log(`🔑 Sesión recuperada con éxito desde Firestore: ${sessionName}`);
    } else {
      creds = initAuthCreds();
      console.log(`🆕 Nueva sesión inicializada para: ${sessionName}`);
    }
  } catch (err) {
    console.warn(`⚠️ Error leyendo credenciales de Firestore, iniciando nuevas:`, err.message);
    creds = initAuthCreds();
  }

  // Memory cache for rapid access during high-frequency encryption handshakes
  const keysCache = new Map();

  const sanitizeKeyId = (type, id) => {
    // Firestore doc IDs cannot contain slashes or certain chars
    return `${type}__${Buffer.from(String(id)).toString('hex')}`;
  };

  const keys = {
    get: async (type, ids) => {
      const data = {};
      const missingIds = [];

      for (const id of ids) {
        const cacheKey = `${type}:${id}`;
        if (keysCache.has(cacheKey)) {
          data[id] = keysCache.get(cacheKey);
        } else {
          missingIds.push(id);
        }
      }

      if (missingIds.length > 0) {
        // Query Firestore for missing keys
        await Promise.all(
          missingIds.map(async (id) => {
            try {
              const docKey = sanitizeKeyId(type, id);
              const docSnap = await keysColRef.doc(docKey).get();
              if (docSnap.exists) {
                const parsed = JSON.parse(docSnap.data().json, BufferJSON.reviver);
                data[id] = parsed;
                keysCache.set(`${type}:${id}`, parsed);
              }
            } catch (err) {
              console.warn(`Error leyendo key ${type}:${id} de Firestore:`, err.message);
            }
          })
        );
      }

      return data;
    },

    set: async (dataset) => {
      const batch = db.batch();
      let count = 0;

      for (const type in dataset) {
        for (const id in dataset[type]) {
          const value = dataset[type][id];
          const cacheKey = `${type}:${id}`;
          const docKey = sanitizeKeyId(type, id);
          const docRef = keysColRef.doc(docKey);

          if (value) {
            keysCache.set(cacheKey, value);
            batch.set(docRef, {
              json: JSON.stringify(value, BufferJSON.replacer),
              type,
              keyId: id,
              updatedAt: new Date()
            }, { merge: true });
          } else {
            keysCache.delete(cacheKey);
            batch.delete(docRef);
          }
          count++;
        }
      }

      if (count > 0) {
        try {
          await batch.commit();
        } catch (err) {
          console.error('Error guardando keys en Firestore batch:', err.message);
        }
      }
    }
  };

  const saveCreds = async () => {
    try {
      await credsDocRef.set({
        json: JSON.stringify(creds, BufferJSON.replacer),
        updatedAt: new Date(),
        sessionName
      });
    } catch (err) {
      console.error('Error guardando credenciales en Firestore:', err.message);
    }
  };

  const clearSession = async () => {
    try {
      keysCache.clear();
      await credsDocRef.delete();
      const allKeys = await keysColRef.get();
      const batch = db.batch();
      allKeys.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      console.log(`🧹 Sesión de Firestore ${sessionName} borrada completamente.`);
    } catch (err) {
      console.error('Error limpiando sesión en Firestore:', err.message);
    }
  };

  return {
    state: {
      creds,
      keys
    },
    saveCreds,
    clearSession
  };
}
