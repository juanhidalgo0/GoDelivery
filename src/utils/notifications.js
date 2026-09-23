// GoDelivery — Push Notifications System (FCM)
import { db, getMessagingInstance } from '../firebase.js';
import { getToken, onMessage } from 'firebase/messaging';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { getState } from '../state.js';
import { showToast } from '../components/toast.js';
import { addDoc, collection } from 'firebase/firestore';
import { AudioManager } from './audio-manager.js';

// TODO: Replace with your VAPID key from Firebase Console
// Go to: Firebase Console → Project Settings → Cloud Messaging → Web Push certificates → Generate key pair
const VAPID_KEY = 'BM6qIHSE3GmXuZqlJvse3_tQ_B1Ymhz4A-5yiomDR7fFxgQuKNeln7q-MRETweqZsPgIhb2ZqZob8SDDULeJLvQ';

let initialized = false;
let listenersAttached = false;

// The app loads its JS from Hosting, but native plugins live in the installed binary.
// Builds published before the migration only ship @capacitor/push-notifications, and
// calling @capacitor-firebase/messaging there fails. This picks whichever plugin the
// binary has and exposes the @capacitor-firebase/messaging API shape for both.
let nativePushPluginPromise = null;
function getNativePushPlugin() {
  if (!nativePushPluginPromise) {
    nativePushPluginPromise = loadNativePushPlugin().catch(err => {
      nativePushPluginPromise = null;
      throw err;
    });
  }
  return nativePushPluginPromise;
}

async function loadNativePushPlugin() {
  const cap = window.Capacitor;
  const hasFirebaseMessaging = typeof cap?.isPluginAvailable === 'function' && cap.isPluginAvailable('FirebaseMessaging');
  if (hasFirebaseMessaging) {
    const { FirebaseMessaging } = await import('@capacitor-firebase/messaging');
    return FirebaseMessaging;
  }

  const { registerPlugin } = await import('@capacitor/core');
  const Legacy = registerPlugin('PushNotifications');
  const tokenWaiters = [];
  Legacy.addListener('registration', (t) => {
    tokenWaiters.splice(0).forEach(w => w.resolve(t?.value || null));
  });
  Legacy.addListener('registrationError', (err) => {
    tokenWaiters.splice(0).forEach(w => w.reject(err));
  });

  return {
    isLegacy: true,
    checkPermissions: () => Legacy.checkPermissions(),
    requestPermissions: () => Legacy.requestPermissions(),
    createChannel: (channel) => Legacy.createChannel(channel),
    registerActionTypes: (types) => Legacy.registerActionTypes(types),
    addListener: (eventName, cb) => {
      if (eventName === 'tokenReceived') {
        return Legacy.addListener('registration', (t) => cb({ token: t?.value }));
      }
      if (eventName === 'notificationReceived') {
        return Legacy.addListener('pushNotificationReceived', (n) => cb({ notification: n }));
      }
      if (eventName === 'notificationActionPerformed') {
        return Legacy.addListener('pushNotificationActionPerformed', cb);
      }
      return Legacy.addListener(eventName, cb);
    },
    getToken: () => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Push registration timed out')), 15000);
      tokenWaiters.push({
        resolve: (token) => { clearTimeout(timer); resolve({ token }); },
        reject: (err) => { clearTimeout(timer); reject(err); }
      });
      Legacy.register().catch(err => { clearTimeout(timer); reject(err); });
    })
  };
}

// Saves the device token for whoever is logged in *now* (not whoever was logged in when the
// listeners were attached: drivers share phones and switch accounts).
let lastSavedTokenKey = '';
let lastSavedTokenAt = 0;
async function saveNativeToken(tokenValue) {
  if (!tokenValue) return;
  try {
    localStorage.setItem('gd_last_fcm_token', tokenValue);
    localStorage.setItem('gd_fcm_registration_status', 'success');
    localStorage.removeItem('gd_fcm_error');
  } catch (e) {}

  let owner = getState().user;
  if (!owner) {
    try {
      const { auth } = await import('../firebase.js');
      owner = auth.currentUser;
    } catch (e) {}
  }
  if (!owner?.uid) return;

  // getToken() and the registration event both deliver the same token on startup.
  const saveKey = `${owner.uid}:${tokenValue}`;
  if (saveKey === lastSavedTokenKey && Date.now() - lastSavedTokenAt < 60 * 1000) return;
  lastSavedTokenKey = saveKey;
  lastSavedTokenAt = Date.now();

  const currentPlatform = window.Capacitor?.getPlatform ? window.Capacitor.getPlatform() : 'web';
  await setDoc(doc(db, 'users', owner.uid, 'fcmTokens', tokenValue), {
    token: tokenValue,
    lastSession: serverTimestamp(),
    updatedAt: serverTimestamp(),
    platform: `${currentPlatform}-native`
  }, { merge: true });

  // Mirror token to user doc root to ensure fallback paths can query it
  await setDoc(doc(db, 'users', owner.uid), {
    lastFcmToken: tokenValue,
    lastFcmTokenUpdatedAt: serverTimestamp()
  }, { merge: true });
}

async function isOfferStillPendingForMe(data) {
  const orderId = data?.orderId || data?.takeOrderId;
  const uid = getState().user?.uid;
  if (!orderId || !uid) return true; // can't tell: better to ring than to miss an offer
  try {
    const { getDoc } = await import('firebase/firestore');
    const snap = await getDoc(doc(db, 'orders', orderId));
    if (!snap.exists()) return false;
    const o = snap.data();
    return !o.driverId && o.queueTargetDriverId === uid;
  } catch (e) {
    return true;
  }
}

/**
 * Where native push stands on this device: 'granted', 'denied', 'prompt' or 'unsupported'
 * (web / plugin missing). Used by the driver panel to warn drivers who won't get offers.
 */
export async function getNativePushPermission() {
  const isNativeApp = window.Capacitor?.getPlatform && window.Capacitor.getPlatform() !== 'web';
  if (!isNativeApp) return 'unsupported';
  try {
    const plugin = await getNativePushPlugin();
    const status = await plugin.checkPermissions();
    return status.receive || 'prompt';
  } catch (e) {
    return 'unsupported';
  }
}

/**
 * Initialize push notifications after user login.
 * Requests permission, gets FCM token, saves to Firestore, listens for foreground messages.
 */
export async function initPushNotifications() {
  // We run this on every session to ensure the token is updated in Firestore
  // but we use a flag to avoid double-attaching onMessage listeners.

  let user = getState().user;
  if (!user) {
    try {
      const { auth } = await import('../firebase.js');
      user = auth.currentUser;
    } catch (e) {}
  }
  if (!user) return;

  try {
    const isNativeApp = window.Capacitor && window.Capacitor.getPlatform && window.Capacitor.getPlatform() !== 'web';
    if (isNativeApp) {
      console.log('[Push] Initializing Native Push Notifications...');
      // @capacitor-firebase/messaging en lugar de @capacitor/push-notifications: en iOS este
      // ultimo devuelve el token APNs crudo, y el backend envia con sendEachForMulticast, que
      // exige tokens FCM. Por eso ningun iPhone podia recibir push. Los dos plugins no pueden
      // convivir, asi que Android tambien pasa por aca (alli ya devolvia FCM, no cambia nada).
      // Los binarios publicados antes de la migracion solo traen el plugin viejo: ver
      // getNativePushPlugin().
      const FirebaseMessaging = await getNativePushPlugin();
      
      let permStatus = await FirebaseMessaging.checkPermissions();
      if (permStatus.receive !== 'granted') {
        permStatus = await FirebaseMessaging.requestPermissions();
      }
      
      if (permStatus.receive === 'granted') {
        if (window.Capacitor.getPlatform() === 'android') {
          try {
            await FirebaseMessaging.createChannel({
              id: 'default',
              name: 'GoDelivery',
              description: 'Notificaciones de pedidos y mensajes',
              importance: 5,
              visibility: 1,
              vibration: true
            });
            await FirebaseMessaging.createChannel({
              id: 'exclusive_offers',
              name: 'Ofertas Exclusivas',
              description: 'Alertas continuas para ofertas exclusivas directas',
              importance: 5,
              visibility: 1,
              vibration: true,
              sound: 'alert.mp3'
            });
            await FirebaseMessaging.createChannel({
              id: 'order_offers',
              name: 'Ofertas de Pedidos',
              description: 'Ofertas de pedidos con botón de aceptación rápida',
              importance: 5,
              visibility: 1,
              vibration: true,
              sound: 'alert.mp3'
            });
            // Channels the server targets (functions/index.js). If one doesn't exist on the
            // device, Android falls back to a low-key default channel and the alert goes unnoticed.
            await FirebaseMessaging.createChannel({
              id: 'admin_alerts',
              name: 'Alertas de Soporte',
              description: 'Nuevos pedidos y avisos para soporte/administración',
              importance: 5,
              visibility: 1,
              vibration: true,
              sound: 'alert.mp3'
            });
            await FirebaseMessaging.createChannel({
              id: 'auto_accept_alerts',
              name: 'Pedidos Auto-aceptados',
              description: 'Aviso cuando un pedido se acepta automáticamente',
              importance: 5,
              visibility: 1,
              vibration: true
            });
          } catch(e) { console.warn('Channel creation error', e); }
        }

        // Las action buttons de ORDER_OFFER ahora se registran nativamente en AppDelegate.swift:
        // @capacitor-firebase/messaging no expone registerActionTypes. Los binarios viejos
        // (plugin legacy) todavia las necesitan desde JS.
        if (FirebaseMessaging.isLegacy) {
          try {
            await FirebaseMessaging.registerActionTypes({
              types: [{
                id: 'ORDER_OFFER',
                actions: [
                  { id: 'ACCEPT_ORDER', title: '⚡ ACEPTAR PEDIDO', foreground: true },
                  { id: 'VIEW_ORDER', title: 'Ver Detalles', foreground: true }
                ]
              }]
            });
          } catch (e) { console.warn('Action types registration error:', e); }
        }

        if (!listenersAttached) {
          listenersAttached = true;
          
          FirebaseMessaging.addListener('tokenReceived', async (event) => {
            console.log('[Push] Native FCM token refreshed');
            try {
              await saveNativeToken(event.token);
            } catch(err) {
              console.error('Error saving push token to database:', err);
            }
          });


          FirebaseMessaging.addListener('notificationReceived', async (event) => {
            console.log('[Push] Native push received in foreground:', event);
          const notification = event.notification || {};
          const { title, body } = notification;
          const isOnDelivery = window.location.hash.startsWith('#/delivery');
          const isAdminAlert = (title && title.includes('[SOPORTE')) || 
                               (notification.data && (notification.data.type === 'admin_support_alert' || notification.data.channelId === 'admin_alerts'));

          // If user is operating as delivery driver, suppress admin duplicate push in foreground so audio is not interrupted
          if (isOnDelivery && isAdminAlert) {
            console.log('[Push] Suppressed admin audit notification in foreground because driver mode is active.');
            return;
          }

          if (title) {
            showToast(`${title}: ${body}`, 'info');
            
            // Check if this is an exclusive offer notification to trigger continuous loops
            const isExclusive = title.includes("OFERTA") || title.includes("Oferta Exclusiva") || (notification.data && (notification.data.type === "exclusive_offer" || notification.data.tag?.includes("exclusive-offer")));
            const isAutoAccept = title.includes("auto-aceptado") || (notification.data && (notification.data.type === "auto_accept" || notification.data.channelId === "auto_accept_alerts"));

            if (isExclusive) {
              // A push can arrive late (bad signal, or the second push of the same offer) when
              // the driver already took the order. Only ring if the offer is still theirs.
              isOfferStillPendingForMe(notification.data).then(pending => {
                if (!pending) return;
                return import('../pages/delivery-panel.js').then(({ playExclusiveOfferAlert }) => {
                  playExclusiveOfferAlert();
                });
              }).catch(err => console.warn('Could not trigger playExclusiveOfferAlert:', err));
            } else if (isAutoAccept) {
              // Play a prominent cash register coin sound for auto-accepted orders
              AudioManager.playSynthChime();
            } else if (!isOnDelivery) {
              AudioManager.playSynthChime();
            }
          }
          const currentUid = getState().user?.uid || user.uid;
          await addDoc(collection(db, 'users', currentUid, 'notifications'), {
            title: title || '',
            body: body || '',
            type: 'system',
            status: 'unread',
            createdAt: serverTimestamp()
          });
        });

        FirebaseMessaging.addListener('notificationActionPerformed', (action) => {
          console.log('[Push] Native push action performed:', action);

          const actionId = action.actionId;
          const n = action.notification || {};
          const orderId = n.data?.orderId || n.data?.takeOrderId || '';

          if (actionId === 'ACCEPT_ORDER' && orderId) {
            console.log('[Push] User pressed ⚡ ACEPTAR PEDIDO on notification action button!');
            window.location.hash = `#/delivery?takeOrderId=${orderId}&autoTake=true`;
            setTimeout(() => {
              window.dispatchEvent(new HashChangeEvent('hashchange'));
            }, 150);
            return;
          }

          let url = '';
          if (action.notification) {
            const n = action.notification;
            if (n.data) {
              url = n.data.url || n.data.targetUrl || n.data.click_action || '';
              if (typeof n.data === 'string') {
                try {
                  const parsed = JSON.parse(n.data);
                  url = url || parsed.url || parsed.targetUrl || parsed.click_action;
                } catch (e) {}
              }
              if (!url) {
                for (const key of Object.keys(n.data)) {
                  if (typeof n.data[key] === 'object' && n.data[key] !== null) {
                    url = n.data[key].url || n.data[key].targetUrl || '';
                    if (url) break;
                  }
                }
              }
            }
            url = url || n.url || n.click_action || '';
          }

          if (url.includes('localhost') || url.includes('127.0.0.1')) {
            url = url.replace(/^https?:\/\/[^\/]+/, 'https://godelivery-magdalena.web.app');
          }
          let targetHash = '';
          if (url.includes('#')) {
            targetHash = url.split('#')[1];
          } else if (url.startsWith('/')) {
            targetHash = url;
          }

          if (orderId && (targetHash.includes('delivery') || !targetHash)) {
            if (!targetHash.includes('takeOrderId')) {
              targetHash = targetHash.includes('?') ? `${targetHash}&takeOrderId=${orderId}` : `/delivery?takeOrderId=${orderId}`;
            }
          }

          if (targetHash) {
            const loggedIn = getState().user;
            if (loggedIn) {
              console.log('[Push] Navigating directly to hash:', targetHash);
              delete window._processedTakeOrderId;
              
              const finalHash = targetHash.startsWith('/') ? `#${targetHash}` : (targetHash.startsWith('#') ? targetHash : `#/${targetHash}`);
              if (finalHash.startsWith('#/admin') || finalHash.startsWith('#admin')) {
                try {
                  sessionStorage.setItem('gd_temp_client_mode', 'true');
                } catch (e) {}
                document.documentElement.classList.remove('is-delivery-mode');
                document.body.classList.remove('is-delivery-mode');
              }
              if (window.location.hash === finalHash) {
                // Force event even if hash didn't change
                window.dispatchEvent(new HashChangeEvent('hashchange'));
              } else {
                window.location.hash = finalHash;
                setTimeout(() => {
                  window.dispatchEvent(new HashChangeEvent('hashchange'));
                }, 150);
              }
            } else {
              console.log('[Push] Deferring navigation, saving to pending URL:', targetHash);
              localStorage.setItem('gd_pending_notification_url', targetHash);
            }
          }
        });
      }

      // getToken() dispara el registro y devuelve el token FCM real en ambas plataformas.
      // Hay que guardarlo aca: 'tokenReceived' solo se dispara cuando el token CAMBIA, asi que
      // en un arranque normal nunca llega y el backend se quedaba sin token para este equipo.
      try {
        const { token } = await FirebaseMessaging.getToken();
        console.log('[Push] FCM token obtenido:', token ? token.slice(0, 12) + '...' : 'vacio');
        await saveNativeToken(token);
      } catch (tokenErr) {
        console.error('[Push] No se pudo obtener el token FCM:', tokenErr);
        try { localStorage.setItem('gd_fcm_registration_status', 'error'); } catch (e) {}
      }
    } else {
      console.warn('[Push] Push permission denied by user. Proceeding without native push notifications.');
      return;
    }
    
    initialized = true;
    return;
  }

    const messaging = await getMessagingInstance();
    if (!messaging) {
      console.warn('Push notifications not supported in this browser');
      return;
    }

    // Check current permission safely for iOS Safari
    if (!('Notification' in window)) {
      console.warn('Push notifications not supported in this browser');
      return;
    }

    if (Notification.permission === 'denied') {
      console.log('Push notifications are blocked by the user settings.');
      return;
    }

    if (Notification.permission === 'granted') {
      await requestAndSaveFcmToken(user);
    } else if (Notification.permission === 'default') {
      console.log('[Push] Notification permission is default. Waiting for user prompt or gesture.');
    }

    const recentlyNotified = window._recentlyNotifiedNotifications || new Set();
    window._recentlyNotifiedNotifications = recentlyNotified;

    // Listen for foreground messages from our custom SW push interceptor (Only once)
    if (!listenersAttached) {
      listenersAttached = true;
      
      navigator.serviceWorker.addEventListener('message', async (event) => {
        if (event.data && event.data.type === 'PUSH_RECEIVED') {
          console.log('Foreground PWA push received:', event.data);
          const { title, body, url, tag } = event.data;
          const dedupKey = tag || `${title}||${body}`;

          if (recentlyNotified.has(dedupKey)) {
            console.log('[Notifications] Suppressing duplicate SW toast for key:', dedupKey);
            return;
          }
          recentlyNotified.add(dedupKey);
          setTimeout(() => recentlyNotified.delete(dedupKey), 5000);

          // Save to Firestore so it appears in the drawer
          if (user && title) {
            await addDoc(collection(db, 'users', user.uid, 'notifications'), {
              title,
              body,
              type: 'push_mirror',
              url: url || '',
              status: 'unread',
              createdAt: new Date()
            });
          }

          // Show in-app premium toast
          if (title) {
            showToast(`${title}: ${body}`, 'info');
            AudioManager.playSound('/assets/sounds/notification.mp3');
            if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
          }
        }
      });

      // Keep Firebase foreground listener as a fallback in case SW channel is loading
      onMessage(messaging, async (payload) => {
        console.log('Foreground Firebase fallback message:', payload);
        const { title, body } = payload.notification || {};
        const tag = payload.data?.tag || payload.notification?.tag;
        const dedupKey = tag || `${title}||${body}`;

        if (recentlyNotified.has(dedupKey)) {
          console.log('[Notifications] Suppressing duplicate Firebase fallback toast for key:', dedupKey);
          return;
        }
        recentlyNotified.add(dedupKey);
        setTimeout(() => recentlyNotified.delete(dedupKey), 5000);

        if (user && title) {
          await addDoc(collection(db, 'users', user.uid, 'notifications'), {
            title,
            body,
            type: 'push_mirror',
            url: payload.data?.url || '',
            status: 'unread',
            createdAt: serverTimestamp()
          });
        }
        if (title) {
          showToast(`${title}: ${body}`, 'info');
          AudioManager.playSound('/assets/sounds/notification.mp3');
          if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
        }
      });
    }

    initialized = true;
  } catch (err) {
    console.error('Error initializing push notifications:', err);
  }
}

export function showNativeNotificationBanner(title, body, tag = '') {
  if (window.Notification && Notification.permission === 'granted') {
    try {
      navigator.serviceWorker.ready.then(reg => {
        reg.showNotification(title, {
          body,
          icon: '/logo-pwa.png',
          tag: tag || `notif-${Date.now()}`,
          renotify: true,
          requireInteraction: true // Non-dismissable persistent status notification
        });
      }).catch(() => {
        new Notification(title, { body, tag, requireInteraction: true });
      });
    } catch (e) {
      new Notification(title, { body, tag, requireInteraction: true });
    }
  }
}

export async function sendLocalNotification(title, body, options = {}) {
  const user = getState().user;
  const isOrderOrChat = options.type?.startsWith('order') || options.type === 'chat_message' || (!options.type && title.includes('Pedido'));
  
  if (user && !isOrderOrChat) {
    // Save to Firestore for the drawer only if it's a promotional or system alert
    await addDoc(collection(db, 'users', user.uid, 'notifications'), {
      title,
      body,
      type: options.type || 'system',
      url: options.url || '',
      status: 'unread',
      createdAt: serverTimestamp()
    });
  }

  // Play foreground sound and vibrate (does not require native notification permission)
  AudioManager.playSound('/assets/sounds/notification.mp3');
  
  if (navigator.vibrate) {
    navigator.vibrate([200, 100, 200, 100, 300]);
  }
}

function showPushRequiredLockScreen() {
  if (document.getElementById('push-permission-lock-screen')) return;

  const lockScreen = document.createElement('div');
  lockScreen.id = 'push-permission-lock-screen';
  lockScreen.style.cssText = `
    position: fixed;
    inset: 0;
    z-index: 999999;
    background: var(--color-bg);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 32px 24px;
    text-align: center;
  `;

  lockScreen.innerHTML = `
    <div style="max-width: 340px; width: 100%; display: flex; flex-direction: column; align-items: center;">
      <div style="width: 90px; height: 90px; border-radius: 50%; background: rgba(225, 29, 72, 0.1); color: var(--color-primary); display: flex; align-items: center; justify-content: center; margin-bottom: 28px; animation: pulse 2s infinite;">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>
      </div>
      <h2 style="font-family: var(--font-display); font-size: 24px; font-weight: 900; color: var(--color-text-primary); margin: 0 0 12px 0;">Notificaciones Requeridas</h2>
      <p style="font-size: 14.5px; color: var(--color-text-secondary); line-height: 1.6; margin: 0 0 32px 0; font-weight: 600;">
        Para poder usar la aplicación y recibir avisos en tiempo real sobre tus pedidos, es obligatorio habilitar las notificaciones de GoDelivery.
      </p>
      <button id="push-permission-grant-btn" style="width: 100%; height: 56px; border: none; background: var(--color-primary); color: white; border-radius: 16px; font-weight: 900; font-size: 16px; cursor: pointer; box-shadow: 0 8px 24px rgba(225, 29, 72, 0.3);">
        Habilitar Notificaciones
      </button>
    </div>
    <style>
      @keyframes pulse {
        0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(225, 29, 72, 0.4); }
        70% { transform: scale(1.05); box-shadow: 0 0 0 15px rgba(225, 29, 72, 0); }
        100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(225, 29, 72, 0); }
      }
    </style>
  `;

  document.body.appendChild(lockScreen);

  document.getElementById('push-permission-grant-btn').onclick = async () => {
    try {
      const FirebaseMessaging = await getNativePushPlugin();
      let status = await FirebaseMessaging.requestPermissions();
      if (status.receive === 'granted') {
        lockScreen.remove();
        await FirebaseMessaging.getToken();
        // Force reload page to resume flows
        window.location.reload();
      } else {
        showToast('Permiso denegado. Es obligatorio para continuar.', 'danger');
      }
    } catch (err) {
      console.error(err);
      showToast('Error al solicitar permisos', 'danger');
    }
  };
}

/**
 * Check if current browser environment is Web/PWA on an iOS device.
 */
export function isIOSWeb() {
  const isNativeApp = window.Capacitor && window.Capacitor.getPlatform && window.Capacitor.getPlatform() !== 'web';
  if (isNativeApp) return false;
  const userAgent = navigator.userAgent || '';
  const isIOS = /iPad|iPhone|iPod/.test(userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return isIOS;
}

/**
 * Request FCM Token for Web/PWA and save it to Firestore under user profile.
 */
export async function requestAndSaveFcmToken(userParam = null) {
  let user = userParam || getState().user;
  if (!user) {
    try {
      const { auth } = await import('../firebase.js');
      user = auth.currentUser;
    } catch (e) {}
  }
  if (!user) return null;

  try {
    const messaging = await getMessagingInstance();
    if (!messaging) {
      console.warn('[Push] Messaging instance not available');
      return null;
    }

    if (!('Notification' in window) || Notification.permission !== 'granted') {
      return null;
    }

    let swRegistration = null;
    if ('serviceWorker' in navigator) {
      try {
        swRegistration = await navigator.serviceWorker.getRegistration();
        if (!swRegistration) {
          swRegistration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
        }
        await navigator.serviceWorker.ready;
      } catch (swErr) {
        console.warn('[Push] Service Worker ready check/registration failed:', swErr);
      }
    }

    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: swRegistration || undefined
    });

    if (token) {
      console.log('[Push] Web FCM Token generated successfully:', token);
      const isIOS = isIOSWeb();
      const platformName = isIOS ? 'ios-pwa' : (navigator.userAgent.includes('Mobile') ? 'mobile-web' : 'desktop-web');

      await setDoc(doc(db, 'users', user.uid, 'fcmTokens', token), {
        token,
        lastSession: serverTimestamp(),
        updatedAt: serverTimestamp(),
        platform: platformName
      }, { merge: true });

      await setDoc(doc(db, 'users', user.uid), {
        lastFcmToken: token,
        lastFcmTokenUpdatedAt: serverTimestamp()
      }, { merge: true });

      console.log('[Push] FCM Token successfully updated in Firestore for platform:', platformName);
      return token;
    } else {
      console.warn('[Push] No FCM token returned by getToken');
    }
  } catch (err) {
    console.error('[Push] Error generating/saving FCM token:', err);
  }
  return null;
}

/**
 * Request Web Push Notification Permission via user gesture and save FCM token if granted.
 */
export async function requestWebPushPermission() {
  if (!('Notification' in window)) return 'unsupported';
  
  try {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      let user = getState().user;
      if (!user) {
        try {
          const { auth } = await import('../firebase.js');
          user = auth.currentUser;
        } catch (e) {}
      }
      if (user) {
        await requestAndSaveFcmToken(user);
      }
    }
    return permission;
  } catch (err) {
    console.error('[Push] Error requesting Web Push permission:', err);
    return 'error';
  }
}




// Drivers depend on push to hear about offers while the phone is in their pocket. Startup
// registration alone was not enough: it runs only after onboarding, only if someone was
// logged in at boot, and never again while the app stays open (a token pruned by the server
// was never replaced). The driver panel calls this whenever the driver is online.
let lastDriverPushCheck = 0;
export async function ensureDriverPushReady({ force = false } = {}) {
  const now = Date.now();
  if (!force && now - lastDriverPushCheck < 10 * 60 * 1000) return null;
  lastDriverPushCheck = now;
  await initPushNotifications();
  return getNativePushPermission();
}
