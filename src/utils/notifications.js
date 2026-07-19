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
      const { PushNotifications } = await import('@capacitor/push-notifications');
      
      let permStatus = await PushNotifications.checkPermissions();
      if (permStatus.receive !== 'granted') {
        permStatus = await PushNotifications.requestPermissions();
      }
      
      if (permStatus.receive === 'granted') {
        if (window.Capacitor.getPlatform() === 'android') {
          try {
            await PushNotifications.createChannel({
              id: 'default',
              name: 'GoDelivery',
              description: 'Notificaciones de pedidos y mensajes',
              importance: 5,
              visibility: 1,
              vibration: true
            });
          } catch(e) { console.warn('Channel creation error', e); }
        }
        await PushNotifications.register();
      } else {
        console.warn('[Push] Push permission denied by user. Proceeding without native push notifications.');
        return;
      }
      
      if (!listenersAttached) {
        listenersAttached = true;
        
        PushNotifications.addListener('registration', async (token) => {
          console.log('[Push] Native token registration success:', token.value);
          localStorage.setItem('gd_last_fcm_token', token.value);
          localStorage.setItem('gd_fcm_registration_status', 'success');
          localStorage.removeItem('gd_fcm_error');
          await setDoc(doc(db, 'users', user.uid, 'fcmTokens', token.value), {
            token: token.value,
            lastSession: serverTimestamp(),
            updatedAt: serverTimestamp(),
            platform: 'android-native'
          }, { merge: true });
        });

        PushNotifications.addListener('registrationError', (error) => {
          console.error('[Push] Native registration error:', error);
          localStorage.setItem('gd_fcm_registration_status', 'error');
          localStorage.setItem('gd_fcm_error', JSON.stringify(error) || String(error));
        });

        PushNotifications.addListener('pushNotificationReceived', async (notification) => {
          console.log('[Push] Native push received in foreground:', notification);
          const { title, body } = notification;
          if (title) {
            showToast(`${title}: ${body}`, 'info');
            AudioManager.playSound('/assets/sounds/notification.mp3');
            
            // For Capacitor native foreground, the in-app Toast and sound are sufficient.
          }
          await addDoc(collection(db, 'users', user.uid, 'notifications'), {
            title: title || '',
            body: body || '',
            type: 'system',
            status: 'unread',
            createdAt: serverTimestamp()
          });
        });

        PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
          console.log('[Push] Native push action performed:', action);
          
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

          if (url) {
            if (url.includes('localhost') || url.includes('127.0.0.1')) {
              url = url.replace(/^https?:\/\/[^\/]+/, 'https://godelivery-magdalena.web.app');
            }
            let targetHash = '';
            if (url.includes('#')) {
              targetHash = url.split('#')[1];
            } else if (url.startsWith('/')) {
              targetHash = url;
            }

            if (targetHash) {
              const loggedIn = getState().user;
              if (loggedIn) {
                console.log('[Push] Navigating directly to hash:', targetHash);
                window.location.hash = targetHash;
                
                // Dispatch HashChangeEvent with a short delay to ensure app webview is awake and routes trigger
                setTimeout(() => {
                  window.dispatchEvent(new HashChangeEvent('hashchange'));
                }, 150);
              } else {
                console.log('[Push] Deferring navigation, saving to pending URL:', targetHash);
                localStorage.setItem('gd_pending_notification_url', targetHash);
              }
            }
          }
        });
      }
      
      initialized = true;
      return;
    }

    const messaging = await getMessagingInstance();
    if (!messaging) {
      console.warn('Push notifications not supported in this browser');
      return;
    }

    // Check current permission
    if (Notification.permission === 'denied') {
      console.log('Push notifications are blocked by the user settings.');
      return;
    }

    if (Notification.permission === 'default') {
      console.log('[Push] Skipping prompt on Web/PWA to avoid conflicts with browser permissions.');
      return;
    }

    // Use existing registration from main.js with safety catch
    let swRegistration;
    try {
      swRegistration = await navigator.serviceWorker.ready;
      if (!swRegistration) {
        throw new Error('Service Worker registration not found');
      }
    } catch (swErr) {
      console.warn('[Push] Service Worker not available or ready check failed (this can happen due to private browsing, cookie restrictions, or low device storage):', swErr);
      return;
    }

    // Get FCM token
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: swRegistration
    });

    if (token) {
      console.log('FCM Token generated:', token);
      // Save/Update token in Firestore under user's document
      await setDoc(doc(db, 'users', user.uid, 'fcmTokens', token), {
        token,
        lastSession: serverTimestamp(),
        updatedAt: serverTimestamp(),
        platform: navigator.userAgent.includes('Mobile') ? 'mobile-web' : 'desktop-web'
      }, { merge: true });
      console.log('FCM Token successfully updated in Firestore for user:', user.uid);
    } else {
      console.warn('No FCM token received. Check VAPID key and Firebase configuration.');
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
              type: 'system',
              url: url || '',
              status: 'unread',
              createdAt: serverTimestamp()
            });
          }

          // Show in-app premium toast
          if (title) {
            showToast(`${title}: ${body}`, 'info');
            AudioManager.playSound('/assets/sounds/notification.mp3');
            if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
            
            // Force native browser notification banner in PWA foreground
            showNativeNotificationBanner(title, body, tag);
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
            type: payload.data?.type || 'system',
            url: payload.data?.url || '',
            status: 'unread',
            createdAt: serverTimestamp()
          });
        }
        if (title) {
          showToast(`${title}: ${body}`, 'info');
          AudioManager.playSound('/assets/sounds/notification.mp3');
          if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
          
          // Force native browser notification banner in PWA foreground
          showNativeNotificationBanner(title, body, tag);
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
          icon: '/assets/img/logo.png',
          tag: tag || `notif-${Date.now()}`,
          renotify: true
        });
      }).catch(() => {
        new Notification(title, { body, tag });
      });
    } catch (e) {
      new Notification(title, { body, tag });
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
      const { PushNotifications } = await import('@capacitor/push-notifications');
      let status = await PushNotifications.requestPermissions();
      if (status.receive === 'granted') {
        lockScreen.remove();
        await PushNotifications.register();
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


