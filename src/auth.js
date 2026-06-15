// GoDelivery — Auth Module
import { auth, googleProvider, db } from './firebase.js';
import { signInWithPopup, signInWithRedirect, getRedirectResult, signOut as fbSignOut, onAuthStateChanged, signInWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc, setDoc, getDocs, collection, query, where, serverTimestamp, runTransaction, onSnapshot } from 'firebase/firestore';
import { setState, getState, clearUserState, setDeliveryAddress } from './state.js';
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
    if (userDocUnsub) {
      userDocUnsub();
      userDocUnsub = null;
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
    
    // Auto-promote if email is in whitelist
    if (ADMIN_EMAILS.includes(data.email) && data.role !== 'admin') {
      updates.role = 'admin';
      data.role = 'admin';
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
            
            // Auto-promote to admin if email is whitelisted
            if (ADMIN_EMAILS.includes(userData.email || user.email) && userData.role !== 'admin') {
              import('firebase/firestore').then(async ({ updateDoc }) => {
                try {
                  await updateDoc(userRef, { role: 'admin' });
                } catch (e) {
                  console.warn('Error upgrading user role to admin:', e);
                }
              });
              userData.role = 'admin';
            }

            if (Array.isArray(userData.favorites)) {
              localStorage.setItem('gd-favorites', JSON.stringify(userData.favorites));
            }

            if (Array.isArray(userData.savedAddresses)) {
              localStorage.setItem('gd-saved-addresses', JSON.stringify(userData.savedAddresses));
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
            console.log('Auth: [onSnapshot] Profile was deleted by an admin, forcing sign out...');
            signOut();
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
