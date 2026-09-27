// Cloud Functions base URL. Production always; the local emulators only in a dev server
// started with VITE_USE_EMULATORS=true (see firebase.js).
const useEmulators = import.meta.env.DEV && import.meta.env.VITE_USE_EMULATORS === 'true';

export function functionUrl(name) {
  return useEmulators
    ? `http://127.0.0.1:5001/demo-godelivery/us-central1/${name}`
    : `https://us-central1-godelivery-magdalena.cloudfunctions.net/${name}`;
}
