// GoDelivery — Auth Module
import { auth, googleProvider, db } from './firebase.js';
import { signInWithPopup, signInWithRedirect, getRedirectResult, signOut as fbSignOut, onAuthStateChanged, signInWithEmailAndPassword, signInWithCredential, GoogleAuthProvider, OAuthProvider, createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { doc, getDoc, setDoc, getDocs, collection, query, where, serverTimestamp, runTransaction, onSnapshot } from 'firebase/firestore';
import { setState, getState, clearUserState, setDeliveryAddress } from './state.js';
import { safeStorage } from './utils/safe-storage.js';
import { showToast } from './components/toast.js';

// Sign in with Email/Password (for testing)
export async function signInWithTestAccount(email, password) {
  try {
    let user;
    try {
      const result = await signInWithEmailAndPassword(auth, email, password);
      user = result.user;
    } catch (err) {
      if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password') {
        // Try creating the account automatically if it's the official reviewer email
        const lowerEmail = email.toLowerCase();
        if (
          lowerEmail === 'testgodeliveryios@gmail.com' ||
          lowerEmail.includes('apple') ||
          lowerEmail.includes('reviewer') ||
          lowerEmail.includes('test') ||
          lowerEmail.includes('codemagic')
        ) {
          console.log('[Auth] Reviewer account not found or invalid, creating it...');
          const result = await createUserWithEmailAndPassword(auth, email, password);
          user = result.user;
        } else {
          throw err;
        }
      } else {
        throw err;
      }
    }
    await ensureUserDoc(user);
    showToast(`¡Sesión de prueba iniciada como ${user.email}!`, 'success');
    return user;
  } catch (error) {
    console.error('Test Auth error:', error);
    showToast('Error al iniciar sesión de prueba: ' + (error.message || 'Desconocido'), 'error');
    return null;
  }
}

const ADMIN_EMAILS = ['kioscopaulos7@gmail.com'];

// Sign in with Google
export async function signInWithGoogle() {
  try {
    googleProvider.setCustomParameters({ prompt: 'select_account' });
    const isNativeApp = window.Capacitor?.isNativePlatform ? window.Capacitor.isNativePlatform() : ((window.Capacitor && window.Capacitor.isNative) || (window.Capacitor && window.Capacitor.getPlatform && window.Capacitor.getPlatform() !== 'web'));
    
    if (isNativeApp) {
      console.log('[Auth] Attempting Native Google Sign-In...');
      try {
        const { GoogleAuth } = await import('@codetrix-studio/capacitor-google-auth');
        
        // Initialize first to ensure serverClientId is configured for Firebase Auth
        const SERVER_CLIENT_ID = '848164656125-dfogmhkrg5fbh0h2vh2r1203n1u1ru5l.apps.googleusercontent.com';
        try {
          await GoogleAuth.initialize({
            clientId: SERVER_CLIENT_ID,
            serverClientId: SERVER_CLIENT_ID,
            scopes: ['profile', 'email'],
            grantOfflineAccess: true
          });
        } catch (initErr) {
          console.warn('[Auth] GoogleAuth.initialize notice:', initErr);
        }
        
        const googleUser = await GoogleAuth.signIn();
        const idToken = googleUser.authentication?.idToken || googleUser.idToken;
        if (!idToken) throw new Error('No se obtuvo el token de autenticación de Google');

        const credential = GoogleAuthProvider.credential(idToken);
        const result = await signInWithCredential(auth, credential);
        const user = result.user;
        await ensureUserDoc(user);
        showToast(`¡Bienvenido, ${user.displayName || user.email}!`, 'success');
        return user;
      } catch (nativeErr) {
        console.error('[Auth] Native Google Sign-In error:', nativeErr);
        if (nativeErr.code === '12501' || nativeErr.message?.toLowerCase().includes('cancel') || nativeErr.message?.toLowerCase().includes('dismissed')) {
          showToast('Inicio de sesión cancelado', 'info');
        } else {
          showToast('Error en inicio de sesión con Google: ' + (nativeErr.message || 'Error de autenticación'), 'error');
        }
        return null;
      }
    }


    // Web / PWA Google Sign-In
    googleProvider.setCustomParameters({ prompt: 'select_account' });

    // 1. Detect if app is embedded inside an iframe (e.g. web simulator tool / preview container)
    const isInsideIframe = window.top !== window.self;

    // 2. Direct Web / PWA Standalone: try Popup first, fallback to Redirect if blocked
    console.log('[Auth] Initiating Web/PWA Google Sign-In with Popup...');
    showToast('Iniciando sesión con Google...', 'info');
    try {
      const result = await signInWithPopup(auth, googleProvider);
      if (result && result.user) {
        await ensureUserDoc(result.user);
        showToast(`¡Bienvenido, ${result.user.displayName || result.user.email}!`, 'success');
        return result.user;
      }
      return null;
    } catch (popupErr) {
      console.warn('[Auth] Popup error during Google Sign-In:', popupErr);
      const code = popupErr?.code || '';

      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        return null;
      }

      if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
        showToast('Redirigiendo a Google...', 'info');
        await signInWithRedirect(auth, googleProvider);
        return null;
      }

      showToast('Error al iniciar sesión: ' + (popupErr.message || 'Desconocido'), 'error');
      return null;
    }
  } catch (error) {
    console.error('Auth error:', error);
    showToast('Error al iniciar sesión con Google: ' + (error.message || 'Desconocido'), 'error');
    return null;
  }
}

// Sign in with Apple
export async function signInWithApple() {
  try {
    const isNativeApp = window.Capacitor?.isNativePlatform ? window.Capacitor.isNativePlatform() : ((window.Capacitor && window.Capacitor.isNative) || (window.Capacitor && window.Capacitor.getPlatform && window.Capacitor.getPlatform() !== 'web'));
    if (isNativeApp) {
      console.log('[Auth] Attempting Native Apple Sign-In...');
      try {
        const { AppleSignIn } = await import('@capawesome/capacitor-apple-sign-in');
        
        const appleUser = await AppleSignIn.signIn({
          scopes: ['EMAIL', 'FULL_NAME']
        });

        const token = appleUser.idToken || appleUser.identityToken;
        if (!token) {
          throw new Error('No se recibió el token de identidad de Apple.');
        }
        
        const provider = new OAuthProvider('apple.com');
        const credential = provider.credential({
          idToken: token
        });
        const result = await signInWithCredential(auth, credential);
        const user = result.user;
        
        // If the user's name is returned on first login, update profile and customize it
        if (appleUser.givenName || appleUser.familyName) {
          const fullName = `${appleUser.givenName || ''} ${appleUser.familyName || ''}`.trim();
          if (fullName) {
            try {
              await updateProfile(user, { displayName: fullName });
            } catch (pErr) {
              console.warn('[Auth] Could not update profile displayName:', pErr);
            }
          }
        }
        
        await ensureUserDoc(user);
        showToast(`¡Bienvenido!`, 'success');
        return user;
      } catch (nativeErr) {
        console.warn('[Auth] Native Apple Sign-In error:', nativeErr);
        const errStr = (nativeErr?.message || nativeErr?.code || String(nativeErr)).toLowerCase();
        if (errStr.includes('cancel') || errStr.includes('canceled') || errStr.includes('cancelled') || nativeErr?.code === '1001' || nativeErr?.code === 'SIGN_IN_CANCELED') {
          showToast('Inicio de sesión cancelado', 'info');
          return null;
        }
        if (errStr.includes('operation-not-allowed') || nativeErr?.code === 'auth/operation-not-allowed') {
          showToast('El inicio de sesión con Apple requiere estar habilitado en la consola de Firebase (Authentication > Sign-in method)', 'error');
          return null;
        }
        showToast('Error al iniciar sesión con Apple: ' + (nativeErr.message || 'Desconocido'), 'error');
        return null;
      }
    }

    console.log('[Auth] Attempting Apple Sign-In with Popup...');
    const provider = new OAuthProvider('apple.com');
    const result = await signInWithPopup(auth, provider);
    const user = result.user;
    await ensureUserDoc(user);
    showToast(`¡Bienvenido!`, 'success');
    return user;
  } catch (error) {
    console.error('Apple Auth error:', error);
    if (error.code === 'auth/popup-closed-by-user' || error.code === 'auth/cancelled-popup-request') {
      showToast('Inicio de sesión cancelado', 'info');
      return null;
    }
    if (error.code === 'auth/operation-not-allowed' || error.message?.includes('operation-not-allowed')) {
      showToast('El inicio de sesión con Apple requiere estar habilitado en Firebase Console', 'error');
      return null;
    }
    showToast('Error al iniciar sesión con Apple: ' + (error.message || 'Desconocido'), 'error');
    return null;
  }
}

// Sign out
export async function signOut() {
  try {
    if (userDocUnsub) {
      userDocUnsub();
      userDocUnsub = null;
    }
    
    // Also sign out from native Google Auth if platform is native
    try {
      const isNativeApp = (window.Capacitor && window.Capacitor.isNative) || (window.Capacitor && window.Capacitor.getPlatform && window.Capacitor.getPlatform() !== 'web');
      if (isNativeApp) {
        const { GoogleAuth } = await import('@codetrix-studio/capacitor-google-auth');
        await GoogleAuth.signOut();
      }
    } catch (e) {
      console.warn('Native Google Auth sign out failed:', e);
    }
    
    await fbSignOut(auth);
    clearUserState();
    sessionStorage.clear();
    showToast('Sesión cerrada', 'info');
    setTimeout(() => {
      window.location.hash = '#/';
      window.location.reload();
    }, 400);
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

    const userAgent = navigator.userAgent || '';
    let deviceOS = 'web';
    if (/iPad|iPhone|iPod/.test(userAgent) && !window.MSStream) {
      deviceOS = 'ios';
    } else if (/Android/.test(userAgent)) {
      deviceOS = 'android';
    }

    const userData = {
      displayName: user.displayName || (user.email === 'test-delivery@godelivery.com' ? 'Test Delivery' : 'Test User'),
      email: user.email || '',
      photoURL: user.photoURL || '',
      role: (isFirst || ADMIN_EMAILS.includes(user.email)) ? 'admin' : (user.email === 'test-delivery@godelivery.com' ? 'admin' : 'user'),
      clientId,
      referralCode,
      createdAt: serverTimestamp(),
      phone: '',
      deviceOS
    };

    // Check if the user was referred by someone
    const sessionRefCode = sessionStorage.getItem('gd-referred-by');
    if (sessionRefCode) {
      userData.referredBy = sessionRefCode;
      userData.referredRewardGranted = false;
      userData.referralWelcomeShown = false;
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
    const updates = {};

    const userAgent = navigator.userAgent || '';
    let deviceOS = 'web';
    if (/iPad|iPhone|iPod/.test(userAgent) && !window.MSStream) {
      deviceOS = 'ios';
    } else if (/Android/.test(userAgent)) {
      deviceOS = 'android';
    }
    if (data.deviceOS !== deviceOS) {
      updates.deviceOS = deviceOS;
      data.deviceOS = deviceOS;
    }

    // Backfill clientId for existing users without one
    if (!data.clientId) {
      const clientId = await getNextClientId();
      updates.clientId = clientId;
      data.clientId = clientId;
    }
    
    // Backfill referralCode for existing users without one
    if (!data.referralCode) {
      const refRand = Math.random().toString(36).substring(2, 7).toUpperCase();
      const refCode = `GO-REF-${refRand}`;
      updates.referralCode = refCode;
      data.referralCode = refCode;
    }
    

    // Auto-promote test delivery account
    if (data.email === 'test-delivery@godelivery.com' && (data.role !== 'admin' || !data.isDelivery)) {
      updates.role = 'admin';
      updates.isDelivery = true;
      updates.deliveryStatus = 'approved';
      updates.deliveryId = 'DL-TEST';

      data.role = 'admin';
      data.isDelivery = true;
      data.deliveryStatus = 'approved';
      data.deliveryId = 'DL-TEST';
    }



    if (Object.keys(updates).length > 0) {
      await setDoc(userRef, updates, { merge: true });
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
      const urlParams = new URLSearchParams(window.location.hash.split('?')[1] || window.location.search);
      const queryEmail = urlParams.get('email') || 'kioscopaulos7@gmail.com';
      const queryName = urlParams.get('name') || 'Vista Previa Kiosco';
      user = {
        uid: 'preview-user',
        displayName: decodeURIComponent(queryName),
        email: queryEmail,
        photoURL: '',
        role: 'admin',
        isAdmin: true,
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

        // Ensure user document exists in Firestore before starting the listener
        await ensureUserDoc(user);

        const userRef = doc(db, 'users', user.uid);
        // Start real-time listener for user profile
        userDocUnsub = onSnapshot(userRef, (snap) => {
          let userData = {};
          if (snap.exists()) {
            userData = snap.data();
            
            if (Array.isArray(userData.favorites)) {
              safeStorage.setItem('gd-favorites', JSON.stringify(userData.favorites));
            }

            if (Array.isArray(userData.savedAddresses)) {
              safeStorage.setItem('gd-saved-addresses', JSON.stringify(userData.savedAddresses));
              setState('savedAddresses', userData.savedAddresses);
            }

            // Restore lastAddress if no active delivery address is present in localStorage
            if (userData.lastAddress && !localStorage.getItem('gd-address')) {
              setDeliveryAddress(
                userData.lastAddress.address,
                userData.lastAddress.notes || '',
                userData.lastAddress.coords || null,
                userData.lastAddress.houseNumber || ''
              );
            }
          } else {
            console.warn('Auth: [onSnapshot] User document not found in Firestore yet, initializing profile data...');
            ensureUserDoc(user).catch(e => console.warn('ensureUserDoc error:', e));
            userData = {
              displayName: user.displayName || user.email || 'Usuario',
              email: user.email || '',
              photoURL: user.photoURL || '',
              role: ADMIN_EMAILS.includes(user.email) ? 'admin' : 'user'
            };
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
  const email = (user.email || '').toLowerCase();
  const isWhitelisted = ADMIN_EMAILS.includes(user.email) || 
                        email === 'testgodeliveryios@gmail.com';
  
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
  
  const hasRole = user.role === 'delivery' || user.role === 'chofer' || user.role === 'driver' || user.role === 'repartidor';
  const hasFlag = user.isDelivery === true || user.isDelivery === 'true' || user.deliveryStatus === 'approved' || user.tripStatus === 'approved';
  const isTest = user.email === 'test-delivery@godelivery.com';

  return hasRole || hasFlag || isTest;
}

export function isOnline() {
  const user = getState().user;
  return user && user.isOnline === true;
}

export function isLoggedIn() {
  return !!getState().user;
}

// Check and show onboarding referral welcome modal
export function checkAndShowReferralWelcome() {
  const currentUser = getState().user;
  if (!currentUser || !currentUser.uid) return;

  if (currentUser.referredBy && (currentUser.completedOrdersCount || 0) === 0 && currentUser.referralWelcomeShown === false) {
    const userRef = doc(db, 'users', currentUser.uid);
    // Mark as shown in Firestore immediately to prevent repeated triggers
    setDoc(userRef, { referralWelcomeShown: true }, { merge: true }).catch(err => console.error(err));

    // Show beautiful gamified modal
    import('./components/modal.js').then(m => {
      const referralPoints = getState().referralPoints || 500;
      m.showModal({
        title: '',
        hideHeader: true,
        height: 'auto',
        persistent: true,
        content: `
          <div style="padding:32px 24px; font-family:var(--font-body); color:var(--color-text-primary); display:flex; flex-direction:column; gap:20px; text-align:center;">
            <div style="font-size:64px; animation: scale-pulse 2s infinite;">🎁</div>
            <h3 style="font-family:var(--font-display); font-size:22px; font-weight:950; margin:0; color:var(--color-primary); letter-spacing:-0.5px;">¡Tienes un Regalo Pendiente!</h3>
            <p style="font-size:14px; color:var(--color-text-secondary); margin:0; line-height:1.5; font-weight:600;">
              Ingresaste a GoDelivery mediante la invitación de un amigo.
            </p>
            <div style="background:var(--color-bg-secondary); border:1.5px solid var(--color-border-light); border-radius:18px; padding:16px; display:flex; align-items:center; justify-content:center; gap:10px; margin-top:8px;">
              <span style="font-size:24px;">🎟️</span>
              <div style="text-align:left;">
                <div style="font-size:11px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.5px;">Bono al primer pedido</div>
                <div style="font-size:18px; font-weight:900; color:#f59e0b; display:flex; align-items:center; gap:4px;">
                  +${referralPoints} GO Points
                </div>
              </div>
            </div>
            <p style="font-size:11.5px; color:var(--color-text-tertiary); margin:0; line-height:1.4; font-weight:500;">
              Cuando realices tu primera compra con éxito, te acreditaremos este bono de forma automática para que lo canjees por descuentos en tus próximos pedidos.
            </p>
            <button id="ref-intro-modal-close-btn" class="btn btn-primary" style="height:48px; border-radius:14px; font-weight:900; font-size:14px; width:100%; border:none; color:white; cursor:pointer; margin-top:12px; box-shadow:0 8px 20px rgba(var(--color-primary-rgb),0.2);">
              ¡ENTENDIDO, GRACIAS!
            </button>
          </div>
        `
      });

      const closeBtn = document.getElementById('ref-intro-modal-close-btn');
      if (closeBtn) {
        closeBtn.onclick = () => m.closeModal();
      }
    });
  }
}
