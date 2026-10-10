// Escrituras de la ubicación del repartidor por la red nativa del teléfono (Android, app en
// segundo plano).
//
// Con la app en segundo plano (pantalla bloqueada, WhatsApp) Android frena a los ~5 minutos los
// pedidos de red que salen del WebView (lo avisa el plugin de GPS). Las escrituras del SDK de
// Firestore quedaban en cola y el cliente veía la moto clavada hasta que el repartidor volvía a
// abrir la app. CapacitorHttp sale por la red nativa, que no tiene ese freno. Usa la API REST de
// Firestore con el token del repartidor, así que pasa por las mismas reglas que el SDK.
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { auth, db } from '../firebase.js';
import { buildCommit } from './firestore-rest.js';

const withTimeout = (promise, ms, what) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`${what}: sin respuesta en ${ms / 1000} s`)), ms)),
]);

/** Solo en la app de Android con la app fuera de pantalla; en primer plano sigue el SDK de siempre. */
export function shouldWriteNatively() {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
      && document.visibilityState === 'hidden'
      && !String(db.app.options.projectId || '').startsWith('demo-'); // emuladores: siempre el SDK
  } catch (e) {
    return false;
  }
}

/** Escribe un documento por la API REST de Firestore (opciones en utils/firestore-rest.js). */
export async function nativeWrite(path, fields, opts = {}) {
  const user = auth.currentUser;
  if (!user) throw new Error('sin sesión');
  const token = await withTimeout(user.getIdToken(), 8000, 'token');
  const { url, body } = buildCommit(db.app.options.projectId, path, fields, opts);
  const res = await withTimeout(CapacitorHttp.post({
    url: `https://firestore.googleapis.com${url}`,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    data: body,
  }), 15000, 'Firestore');
  if (res.status < 200 || res.status >= 300) {
    const err = new Error(`Firestore respondió ${res.status}: ${JSON.stringify(res.data).slice(0, 160)}`);
    err.status = res.status;
    throw err;
  }
}
