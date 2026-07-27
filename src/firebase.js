import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, setPersistence, browserLocalPersistence } from 'firebase/auth';
import { 
  initializeFirestore, 
  persistentLocalCache, 
  persistentMultipleTabManager,
  clearIndexedDbPersistence
} from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getMessaging, isSupported } from 'firebase/messaging';

const isTestingHost = typeof window !== 'undefined' && (
  window.location.hostname.includes('godelivery-testing') ||
  window.location.hostname.includes('testing')
);
const isTesting = import.meta.env.VITE_FIREBASE_ENV === 'testing' || import.meta.env.MODE === 'testing' || isTestingHost;

const prodConfig = {
  apiKey: "AIzaSyAldeFtUWWlEpcuEg1LSTko90cVEvnsMLA",
  authDomain: "godelivery-magdalena.firebaseapp.com",
  projectId: "godelivery-magdalena",
  storageBucket: "godelivery-magdalena.firebasestorage.app",
  messagingSenderId: "848164656125",
  appId: "1:848164656125:web:eef2314205f5d8f887ff94",
  measurementId: "G-80XHGQE5RR"
};

const testingConfig = {
  apiKey: "AIzaSyDqyQ6aRA_1q0E8GUb6nqXIJhghzD4L00A",
  authDomain: "godelivery-testing.firebaseapp.com",
  projectId: "godelivery-testing",
  storageBucket: "godelivery-testing.firebasestorage.app",
  messagingSenderId: "584541077992",
  appId: "1:584541077992:web:20c37a8b58595bf510e45d",
  measurementId: "G-DWNQDRZG27"
};

const firebaseConfig = isTesting ? testingConfig : prodConfig;
if (isTesting) {
  console.log("🧪 Running in TESTING environment (godelivery-testing)");
}

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Enforce browserLocalPersistence to guarantee session survival across iOS Safari / PWA reloads & redirects
setPersistence(auth, browserLocalPersistence).catch((err) => {
  console.warn('[Firebase Auth] Could not set browserLocalPersistence:', err);
});

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: 'select_account'
});

// Modern Firestore initialization with Persistent Local Cache
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache()
});

// Clear IndexedDB offline cache if flagged by hard reset
if (localStorage.getItem('gd_clear_persistence') === 'true') {
  localStorage.removeItem('gd_clear_persistence');
  clearIndexedDbPersistence(db).then(() => {
    console.log('Firestore IndexedDB persistence cleared successfully.');
  }).catch(err => {
    console.warn('Error clearing Firestore persistence:', err);
  });
}


export const storage = getStorage(app);

// Messaging (may not be supported in all browsers)
let messagingInstance = null;
export async function getMessagingInstance() {
  if (messagingInstance) return messagingInstance;
  const supported = await isSupported();
  if (supported) {
    messagingInstance = getMessaging(app);
  }
  return messagingInstance;
}

