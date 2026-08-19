import { initializeApp } from 'firebase/app';
import { getFirestore, collection, collectionGroup, getDocs } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyDFaOVxf6QfK03rRTVfIH84HLc5Qujzrew",
  authDomain: "godelivery-magdalena.firebaseapp.com",
  projectId: "godelivery-magdalena",
  storageBucket: "godelivery-magdalena.firebasestorage.app",
  messagingSenderId: "848164656125",
  appId: "1:848164656125:web:86b4a5df1ab82cae7eb886"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function countNativeUsers() {
  console.log('=== COUNTING NATIVE INSTALLED USERS ===');
  
  const tokensSnap = await getDocs(collectionGroup(db, 'fcmTokens'));
  console.log('Total FCM Tokens in DB:', tokensSnap.size);

  const nativeAndroidUsers = new Set();
  const nativeIosUsers = new Set();
  const webUsers = new Set();
  const unknownPlatformUsers = new Set();

  tokensSnap.docs.forEach(docSnap => {
    const data = docSnap.data();
    const pathParts = docSnap.ref.path.split('/');
    const userId = pathParts[1]; // users/{userId}/fcmTokens/{tokenId}
    const platform = data.platform || '';

    if (platform.includes('android')) {
      nativeAndroidUsers.add(userId);
    } else if (platform.includes('ios')) {
      nativeIosUsers.add(userId);
    } else if (platform.includes('web')) {
      webUsers.add(userId);
    } else {
      unknownPlatformUsers.add(userId);
    }
  });

  const usersSnap = await getDocs(collection(db, 'users'));
  let totalUsers = usersSnap.size;
  let usersWithFcmRoot = 0;

  usersSnap.docs.forEach(docSnap => {
    const data = docSnap.data();
    if (data.lastFcmToken) usersWithFcmRoot++;
  });

  console.log('\n--- METRICS SUMMARY ---');
  console.log('Total registered users in Firestore:', totalUsers);
  console.log('Unique users with Native Android App:', nativeAndroidUsers.size);
  console.log('Unique users with Native iOS App:', nativeIosUsers.size);
  console.log('Unique users with Web / PWA Push:', webUsers.size);
  console.log('Unique users with FCM Token set on root:', usersWithFcmRoot);
  
  process.exit(0);
}

countNativeUsers().catch(console.error);
