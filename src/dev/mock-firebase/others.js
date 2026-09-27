// SOLO DESARROLLO: reemplazos mínimos de firebase/app, auth, storage y messaging para las vistas previas.

export const initializeApp = () => ({ name: 'mock-app' });

// ── auth ──
const mockUser = () => window.__mockAuthUser || null;
const authListeners = new Set();
export const getAuth = () => ({ get currentUser() { return mockUser(); }, onAuthStateChanged: (cb) => onAuthStateChanged(null, cb) });
export function onAuthStateChanged(_auth, cb) { authListeners.add(cb); setTimeout(() => cb(mockUser()), 0); return () => authListeners.delete(cb); }
export class GoogleAuthProvider { addScope() {} setCustomParameters() {} static credential() { return {}; } }
export class OAuthProvider { constructor() {} addScope() {} setCustomParameters() {} credential() { return {}; } }
export const browserLocalPersistence = {};
export const setPersistence = async () => {};
export const connectAuthEmulator = () => {};
const noAuth = async () => { throw new Error('Vista previa: sin inicio de sesión real'); };
export const createUserWithEmailAndPassword = noAuth;
export const signInWithEmailAndPassword = noAuth;
export const signInWithPopup = noAuth;
export const signInWithRedirect = noAuth;
export const signInWithCredential = noAuth;
export const getRedirectResult = async () => null;
export const signOut = async () => {};
export const updateProfile = async () => {};

// ── storage ──
export const getStorage = () => ({});
export const connectStorageEmulator = () => {};
export const ref = (_s, path) => ({ fullPath: path });
export const uploadBytes = async () => ({});
export const uploadBytesResumable = () => ({ on: () => {}, then: (f) => f({}) });
export const uploadString = async () => ({});
export const getDownloadURL = async () => '/logo.png';
export const deleteObject = async () => {};

// ── messaging ──
export const getMessaging = () => ({});
export const isSupported = async () => false;
export const getToken = async () => '';
export const onMessage = () => () => {};
