// GoDelivery — Global Background Geolocation Tracking for Delivery Drivers
import { db } from '../firebase.js';
import { collection, query, where, onSnapshot, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { subscribe, getState } from '../state.js';
import { isDelivery } from '../auth.js';

let userSub = null;
let activeOrdersUnsub = null;
let locationWatchId = null;
let currentActiveOrders = [];
let wakeLock = null;

// Self-healing & redundancy timers
let lastLocationUpdateTime = 0;
let watchdogInterval = null;
let errorRetryTimeout = null;

export function initGlobalTracking() {
  // Clean up any existing subscription to avoid duplicate listeners
  if (userSub) {
    userSub();
    userSub = null;
  }

  console.log('Background Tracking: Initializing global tracker with reactive subscriber...');

  // 1. Reactive subscription to user state updates to bypass the Firestore profile loading race condition
  userSub = subscribe('user', (user) => {
    if (!user || !isDelivery()) {
      console.log('Background Tracking: User logged out or not a driver. Stopping global tracking.');
      stopGlobalTracking();
      return;
    }
    
    setupOrdersListener(user);
  });

  // 2. Trigger immediately if user profile is already fully loaded in state
  const currentUser = getState().user;
  if (currentUser && isDelivery()) {
    setupOrdersListener(currentUser);
  }

  // 3. Re-acquire Wake Lock when tab becomes visible
  document.addEventListener('visibilitychange', handleVisibilityChange);
}

async function handleVisibilityChange() {
  if (wakeLock !== null && document.visibilityState === 'visible') {
    await requestWakeLock();
  }
}

function setupOrdersListener(user) {
  if (activeOrdersUnsub) return; // Already listening

  console.log('Background Tracking: Setting up active orders listener for driver:', user.uid);

  const q = query(
    collection(db, 'orders'),
    where('driverId', '==', user.uid),
    where('status', 'in', [
      'confirmed', 'confirmado',
      'preparing', 'preparando',
      'ready', 'listo',
      'delivering', 'en camino'
    ])
  );

  activeOrdersUnsub = onSnapshot(q, (snap) => {
    currentActiveOrders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    console.log(`Background Tracking: Active orders updated. Count: ${currentActiveOrders.length}`);
    
    if (currentActiveOrders.length > 0) {
      startWatching();
    } else {
      stopWatching();
    }
  }, (err) => {
    console.error('Background Tracking: Firestore orders listener failed:', err);
  });
}

async function requestWakeLock() {
  if ('wakeLock' in navigator) {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      console.log('Background Tracking: Wake Lock active');
      wakeLock.addEventListener('release', () => {
        console.log('Background Tracking: Wake Lock released');
      });
    } catch (err) {
      console.warn('WakeLock failed:', err.message);
    }
  }
}

async function startWatching() {
  if (locationWatchId) return; // Already tracking

  if (!navigator.geolocation) {
    console.error('Background Tracking: Geolocation not supported by this browser');
    return;
  }

  console.log('Background Tracking: Starting location watch sensor...');
  await requestWakeLock();

  lastLocationUpdateTime = Date.now();
  
  const geoOptions = {
    enableHighAccuracy: true,
    maximumAge: 0,
    timeout: 10000
  };

  const onGeoSuccess = async (pos) => {
    const { latitude, longitude } = pos.coords;
    lastLocationUpdateTime = Date.now();
    
    // Cache position in global window context for instant access across modals/maps
    window.lastRiderPos = { lat: latitude, lng: longitude };
    console.log(`Background Tracking: Location successfully update: [${latitude}, ${longitude}]`);

    // Módulo 3.1: Geofencing
    window.triggeredGeofences = window.triggeredGeofences || {};

    for (const o of currentActiveOrders) {
      const orderGeofenceKey = o.id;
      window.triggeredGeofences[orderGeofenceKey] = window.triggeredGeofences[orderGeofenceKey] || { commerce: false, customer: false };

      // 1. Check distance to commerce (<= 200m)
      const commerceCoords = o.comercioCoords || o.pickupCoords;
      if (commerceCoords && !window.triggeredGeofences[orderGeofenceKey].commerce) {
        const distToCommerce = getHaversineDistance(latitude, longitude, commerceCoords.lat, commerceCoords.lng);
        if (distToCommerce <= 200) {
          window.triggeredGeofences[orderGeofenceKey].commerce = true;
          console.log(`[Geofencing] Driver is close to commerce for order ${o.id} (${Math.round(distToCommerce)}m). Triggering notification...`);
          
          try {
            if (o.comercioId) {
              const { getDoc, doc, collection, addDoc } = await import('firebase/firestore');
              const comSnap = await getDoc(doc(db, 'comercios', o.comercioId));
              if (comSnap.exists()) {
                const ownerId = comSnap.data().ownerId;
                if (ownerId) {
                  await addDoc(collection(db, 'users', ownerId, 'notifications'), {
                    title: 'Repartidor cerca',
                    body: `El repartidor está a ${Math.round(distToCommerce)}m. Prepará el empaque final para el pedido #${o.orderId || o.id.slice(0, 6)}.`,
                    type: 'system',
                    status: 'unread',
                    createdAt: serverTimestamp()
                  });
                }
              }
            }
          } catch (e) {
            console.error('[Geofencing] Error notifying commerce:', e);
          }
        }
      }

      // 2. Check distance to customer (<= 100m)
      if (o.deliveryCoords && !window.triggeredGeofences[orderGeofenceKey].customer) {
        const distToCustomer = getHaversineDistance(latitude, longitude, o.deliveryCoords.lat, o.deliveryCoords.lng);
        if (distToCustomer <= 100) {
          window.triggeredGeofences[orderGeofenceKey].customer = true;
          console.log(`[Geofencing] Driver is close to customer for order ${o.id} (${Math.round(distToCustomer)}m). Triggering notification...`);

          try {
            if (o.userId) {
              const { collection, addDoc } = await import('firebase/firestore');
              await addDoc(collection(db, 'users', o.userId, 'notifications'), {
                title: '¡Tu repartidor está en la puerta!',
                body: 'Prepárate para recibir tu pedido. ¡Ya llegó!',
                type: 'system',
                status: 'unread',
                createdAt: serverTimestamp()
              });
            }
          } catch (e) {
            console.error('[Geofencing] Error notifying customer:', e);
          }
        }
      }
    }

    const updates = currentActiveOrders.map(o => {
      return updateDoc(doc(db, 'orders', o.id), {
        driverLocation: {
          lat: latitude,
          lng: longitude,
          updatedAt: serverTimestamp()
        }
      });
    });

    try {
      await Promise.all(updates);
    } catch (err) {
      console.error('Background Tracking: Failed to update order locations in Firestore:', err);
    }
  };

  const onGeoError = (err) => {
    console.warn(`Background Tracking Watch Error (Code ${err.code}): ${err.message}`);
    
    // Auto-recovery: If we lose GPS signal (timeout code 3, or position unavailable code 2)
    // program a clean retry in 5 seconds to hook back when coverage returns
    if (err.code === 3 || err.code === 2) {
      if (!errorRetryTimeout) {
        console.log('Background Tracking: GPS dropout detected. Scheduling self-healing retry in 5s...');
        errorRetryTimeout = setTimeout(() => {
          errorRetryTimeout = null;
          if (currentActiveOrders.length > 0) {
            restartWatching();
          }
        }, 5000);
      }
    }
  };

  locationWatchId = navigator.geolocation.watchPosition(onGeoSuccess, onGeoError, geoOptions);

  // 4. Watchdog Timer: Wake up the GPS sensor if background throttling froze the watchPosition callback
  if (!watchdogInterval) {
    watchdogInterval = setInterval(() => {
      const elapsed = Date.now() - lastLocationUpdateTime;
      if (currentActiveOrders.length > 0 && elapsed > 25000) {
        console.warn(`Background Tracking Watchdog: GPS sensor inactive for ${Math.round(elapsed / 1000)}s with active orders! Reviving sensor...`);
        restartWatching();
      }
    }, 15000); // Check every 15 seconds
  }
}

function restartWatching() {
  console.log('Background Tracking: Executing forced clean watchPosition restart...');
  if (locationWatchId) {
    navigator.geolocation.clearWatch(locationWatchId);
    locationWatchId = null;
  }
  if (errorRetryTimeout) {
    clearTimeout(errorRetryTimeout);
    errorRetryTimeout = null;
  }
  startWatching();
}

function stopWatching() {
  console.log('Background Tracking: Deactivating active geolocation sensors and timers...');
  if (locationWatchId) {
    navigator.geolocation.clearWatch(locationWatchId);
    locationWatchId = null;
  }
  if (wakeLock) {
    wakeLock.release().then(() => wakeLock = null).catch(() => {});
  }
  if (watchdogInterval) {
    clearInterval(watchdogInterval);
    watchdogInterval = null;
  }
  if (errorRetryTimeout) {
    clearTimeout(errorRetryTimeout);
    errorRetryTimeout = null;
  }
}

export function stopGlobalTracking() {
  console.log('Background Tracking: Completely shutting down global tracking system...');
  
  if (userSub) {
    userSub();
    userSub = null;
  }
  if (activeOrdersUnsub) {
    activeOrdersUnsub();
    activeOrdersUnsub = null;
  }
  
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  
  stopWatching();
}

function getHaversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // metres
  const phi1 = lat1 * Math.PI/180;
  const phi2 = lat2 * Math.PI/180;
  const deltaPhi = (lat2-lat1) * Math.PI/180;
  const deltaLambda = (lon2-lon1) * Math.PI/180;

  const a = Math.sin(deltaPhi/2) * Math.sin(deltaPhi/2) +
            Math.cos(phi1) * Math.cos(phi2) *
            Math.sin(deltaLambda/2) * Math.sin(deltaLambda/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // in metres
}
