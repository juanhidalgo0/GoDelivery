// GoDelivery — Auth Module
import { auth, googleProvider, db } from './firebase.js';
import { signInWithPopup, signInWithRedirect, getRedirectResult, signOut as fbSignOut, onAuthStateChanged, signInWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc, setDoc, getDocs, collection, query, where, serverTimestamp, runTransaction, onSnapshot } from 'firebase/firestore';
import { setState, getState, clearUserState } from './state.js';
import { showToast } from './components/toast.js';

// Sign in with Email/Password (for testing)
export async function signInWithTestAccount(email, password) {
  try {
    const result = await signInWithEmailAndPassword(auth, email, password);
    const user = result.user;
    await ensureUserDoc(user);
    showToast(`¡Sesión de prueba iniciada como ${user.email}!`, 'success');
    return user;
  } catch (error) {
    console.error('Test Auth error:', error);
    showToast('Error al iniciar sesión de prueba. ¿Existen las credenciales?', 'error');
    return null;
  }
}

const ADMIN_EMAILS = ['kioscopaulos7@gmail.com'];

// Sign in with Google
export async function signInWithGoogle() {
  try {
    console.log('[Auth] Attempting Google Sign-In with Popup...');
    const result = await signInWithPopup(auth, googleProvider);
    const user = result.user;
    await ensureUserDoc(user);
    showToast(`¡Bienvenido, ${user.displayName}!`, 'success');
    return user;
  } catch (error) {
    console.error('Auth error:', error);
    
    const isRedirectFallback = 
      error.code === 'auth/popup-blocked' || 
      error.code === 'auth/popup-closed-by-user' ||
      error.code === 'auth/operation-not-supported-in-this-environment';
      
    if (isRedirectFallback) {
      showToast('Redirigiendo a inicio de sesión con Google...', 'info');
      try {
        console.log('[Auth] Popup blocked or not supported, falling back to Redirect...');
        await signInWithRedirect(auth, googleProvider);
      } catch (redirectErr) {
        console.error('Fallback redirect error:', redirectErr);
        showToast('Error al redirigir. Inténtalo nuevamente.', 'error');
      }
    } else if (error.code === 'auth/cancelled-popup-request') {
      console.log('Multiple auth requests detected.');
    } else {
      showToast('Error al iniciar sesión: ' + (error.message || 'Desconocido'), 'error');
    }
    return null;
  }
}

// Sign out
export async function signOut() {
  try {
    await fbSignOut(auth);
    clearUserState();
    showToast('Sesión cerrada', 'info');
  } catch (error) {
    console.error('Sign out error:', error);
    showToast('Error al cerrar sesión', 'error');
  }
}

// Ensure user document exists in Firestore
async function ensureUserDoc(user) {
  const userRef = doc(db, 'users', user.uid);
  const userSnap = await getDoc(userRef);

  if (!userSnap.exists()) {
    // Check if this is the first user (superadmin)
    let isFirst = false;
    try {
      const usersQuery = query(collection(db, 'users'));
      const usersSnap = await getDocs(usersQuery);
      isFirst = usersSnap.empty;
    } catch (e) {
      console.warn('GoDelivery: Could not check if first user due to permission limits, defaulting to false.', e);
    }

    // Generate auto-incremental clientId
    const clientId = await getNextClientId();

    // Generate unique referral code for the new user
    const refRand = Math.random().toString(36).substring(2, 7).toUpperCase();
    const referralCode = `GO-REF-${refRand}`;

    const userData = {
      displayName: user.displayName || (user.email === 'test-delivery@godelivery.com' ? 'Test Delivery' : 'Test User'),
      email: user.email || '',
      photoURL: user.photoURL || '',
      role: (isFirst || ADMIN_EMAILS.includes(user.email)) ? 'admin' : (user.email === 'test-delivery@godelivery.com' ? 'delivery' : 'user'),
      clientId,
      referralCode,
      createdAt: serverTimestamp(),
      phone: ''
    };

    // Check if the user was referred by someone
    const sessionRefCode = sessionStorage.getItem('gd-referred-by');
    if (sessionRefCode) {
      userData.referredBy = sessionRefCode;
      userData.referredRewardGranted = false;
    }

    if (user.email === 'test-delivery@godelivery.com') {
      userData.isDelivery = true;
      userData.deliveryStatus = 'approved';
      userData.deliveryId = 'DL-TEST';
    }

    await setDoc(userRef, userData);

    if (isFirst) {
      showToast('🎉 ¡Sos el Administrador!', 'success');
    }

    setState('user', { uid: user.uid, ...userData });
  } else {
    const data = userSnap.data();
    // Backfill clientId for existing users without one
    if (!data.clientId) {
      const clientId = await getNextClientId();
      await setDoc(userRef, { clientId }, { merge: true });
      data.clientId = clientId;
    }
    
    // Backfill referralCode for existing users without one
    if (!data.referralCode) {
      const refRand = Math.random().toString(36).substring(2, 7).toUpperCase();
      const refCode = `GO-REF-${refRand}`;
      await setDoc(userRef, { referralCode: refCode }, { merge: true });
      data.referralCode = refCode;
    }
    
    // Auto-promote if email is in whitelist
    if (ADMIN_EMAILS.includes(data.email) && data.role !== 'admin') {
      await setDoc(userRef, { role: 'admin' }, { merge: true });
      data.role = 'admin';
    }

    // Auto-promote test delivery account
    if (data.email === 'test-delivery@godelivery.com' && !data.isDelivery) {
      await setDoc(userRef, { 
        role: 'delivery', 
        isDelivery: true, 
        deliveryStatus: 'approved',
        deliveryId: 'DL-TEST'
      }, { merge: true });
      data.role = 'delivery';
      data.isDelivery = true;
      data.deliveryStatus = 'approved';
      data.deliveryId = 'DL-TEST';
    }
    
    setState('user', { uid: user.uid, ...data });
  }
}

// Auto-incremental ID generator using Firestore transaction
async function getNextClientId() {
  const counterRef = doc(db, 'counters', 'users');
  try {
    const newId = await runTransaction(db, async (transaction) => {
      const counterSnap = await transaction.get(counterRef);
      let nextId = 1001; // Start from 1001
      if (counterSnap.exists()) {
        nextId = (counterSnap.data().lastClientId || 1000) + 1;
      }
      transaction.set(counterRef, { lastClientId: nextId }, { merge: true });
      return nextId;
    });
    return newId;
  } catch (err) {
    console.error('Error generating clientId:', err);
    // Fallback: use timestamp-based ID
    return Math.floor(Date.now() / 1000) % 100000;
  }
}

// Listen to auth state changes
let userDocUnsub = null;
let currentUserId = undefined; // undefined indicates it hasn't resolved initially yet

export function initAuth(callback) {
  // Capture redirect credentials from Google sign-in
  getRedirectResult(auth)
    .then(async (result) => {
      if (result && result.user) {
        console.log('Auth: [getRedirectResult] Successful redirect login for', result.user.email);
        await ensureUserDoc(result.user);
      }
    })
    .catch((err) => {
      console.error('Auth: [getRedirectResult] Error processing redirect', err);
      showToast('Error al procesar el inicio de sesión: ' + (err.message || 'Desconocido'), 'error');
    });

  onAuthStateChanged(auth, async (user) => {
    if (userDocUnsub) {
      userDocUnsub();
      userDocUnsub = null;
    }

    const isPreview = window.location.hash.includes('preview=true') || window.location.search.includes('preview=true');

    if (isPreview && !user) {
      user = {
        uid: 'preview-user',
        displayName: 'Vista Previa Kiosco',
        email: 'kioscopaulos7@gmail.com',
        photoURL: '',
        role: 'user',
        isReadOnly: true
      };
    }

    if (user) {
      try {
        if (user.uid === 'preview-user') {
          setState('user', user);
          setState('loading', false);
          if (currentUserId !== user.uid) {
            currentUserId = user.uid;
            if (callback) callback(getState().user);
          }
          return;
        }

        const userRef = doc(db, 'users', user.uid);
        // Start real-time listener for user profile
        userDocUnsub = onSnapshot(userRef, (snap) => {
          let userData = {};
          if (snap.exists()) {
            userData = snap.data();
            if (Array.isArray(userData.favorites)) {
              localStorage.setItem('gd-favorites', JSON.stringify(userData.favorites));
            }
          } else {
            console.log('Auth: [onSnapshot] Profile not found, creating...');
            ensureUserDoc(user);
          }
          
          setState('user', { uid: user.uid, ...userData });
          setState('loading', false);
          
          // Call callback if the user ID changed (meaning they just logged in, or first load)
          if (currentUserId !== user.uid) {
            currentUserId = user.uid;
            if (callback) callback(getState().user);
          }
        }, (err) => {
          console.error('User doc listener error:', err);
          const currentUser = getState().user;
          if (!currentUser) {
            setState('user', { uid: user.uid, displayName: user.displayName, email: user.email });
          }
          setState('loading', false);
          if (currentUserId !== user.uid) {
            currentUserId = user.uid;
            if (callback) callback(getState().user);
          }
        });
      } catch (err) {
        console.error('Error setting up user listener:', err);
        setState('user', { uid: user.uid, displayName: user.displayName, email: user.email });
        setState('loading', false);
        if (currentUserId !== user.uid) {
          currentUserId = user.uid;
          if (callback) callback(getState().user);
        }
      }
    } else {
      clearUserState();
      setState('loading', false);
      if (currentUserId !== null) {
        currentUserId = null;
        if (callback) callback(null);
      }
    }
  });
}

// Check roles
export function isAdmin() {
  const user = getState().user;
  if (!user) return false;
  
  // Hardcoded whitelist check for emergency recovery
  const isWhitelisted = ADMIN_EMAILS.includes(user.email);
  
  return !!user.isAdmin || user.role === 'admin' || isWhitelisted;
}

export function isSuperAdmin() {
  return isAdmin();
}

export function isComercio() {
  const user = getState().user;
  if (!user) return false;
  return !!user.isComercio || user.role === 'comercio' || user.role === 'admin' || user.role === 'superadmin';
}

export function isDelivery() {
  const user = getState().user;
  if (!user) return false;
  
  const isApproved = user.deliveryStatus === 'approved';
  const hasRole = user.role === 'delivery';
  const hasField = user.isDelivery === true;
  const isTest = user.email === 'test-delivery@godelivery.com';

  const result = isApproved || hasRole || hasField || isTest;
  
  return result;
}

export function isOnline() {
  const user = getState().user;
  return user && user.isOnline === true;
}

export function isLoggedIn() {
  return !!getState().user;
}
