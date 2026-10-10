// PIN del panel de comercio. Vive en comercios/{id}/private/access (sólo dueño y
// admin lo leen); antes estaba en el doc público del comercio, que lee cualquiera.
// Los comercios que todavía lo tienen ahí se migran solos la primera vez que el
// dueño (o el admin) entra al panel.
import { doc, getDoc, setDoc, updateDoc, deleteField } from 'firebase/firestore';
import { db } from '../firebase.js';

const accessRef = (comercioId) => doc(db, 'comercios', comercioId, 'private', 'access');

export async function getCommercePin(comercioId, publicData = null) {
  let pin = '';
  try {
    const snap = await getDoc(accessRef(comercioId));
    if (snap.exists()) pin = String(snap.data().pin || '');
  } catch (e) {
    console.warn('[PIN] No se pudo leer el PIN privado:', e?.code || e);
  }

  const legacy = publicData?.pin;
  if (legacy !== undefined) {
    try {
      if (!pin && String(legacy).trim()) {
        pin = String(legacy).trim();
        await setDoc(accessRef(comercioId), { pin }, { merge: true });
      }
      await updateDoc(doc(db, 'comercios', comercioId), { pin: deleteField() });
    } catch (e) {
      console.warn('[PIN] No se pudo migrar el PIN viejo:', e?.code || e);
      if (!pin) pin = String(legacy || '').trim();
    }
  }
  return pin;
}

export async function setCommercePin(comercioId, pin) {
  await setDoc(accessRef(comercioId), { pin: String(pin || '').trim() }, { merge: true });
}

export const isValidPin = (pin) => pin === '' || /^\d{4}$/.test(pin);
