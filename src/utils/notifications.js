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

  const user = getState().user;
  if (!user) return;

  try {
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
      // Show smart prompt instead of immediate raw request
      const { showNotificationPrompt } = await import('../components/notification-prompt.js');
      showNotificationPrompt(() => {
        // Callback if granted - re-run init to get token
        initialized = false;
        initPushNotifications();
      });
      return;
    }

    // Use existing registration from main.js
    const swRegistration = await navigator.serviceWorker.ready;

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
        }
      });
    }

    initialized = true;
  } catch (err) {
    console.error('Error initializing push notifications:', err);
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
