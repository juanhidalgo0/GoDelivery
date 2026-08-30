// GoDelivery — Global Background Geolocation Tracking for Delivery Drivers
import { db } from '../firebase.js';
import { collection, query, where, onSnapshot, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { subscribe, getState } from '../state.js';
import { isDelivery } from '../auth.js';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';

let BackgroundGeolocation = null;
try {
  BackgroundGeolocation = registerPlugin('BackgroundGeolocation');
} catch (e) {}

let userSub = null;
let activeOrdersUnsub = null;
let locationWatchId = null;
let nativeWatcherId = null;
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
    if (user.isOnline === true) {
      startWatching();
    }
  });

  // 2. Trigger immediately if user profile is already fully loaded in state
  const currentUser = getState().user;
  if (currentUser && isDelivery()) {
    setupOrdersListener(currentUser);
    if (currentUser.isOnline === true) {
      startWatching();
    }
  }

  // 3. Re-acquire Wake Lock when tab becomes visible
  document.addEventListener('visibilitychange', handleVisibilityChange);
}

async function handleVisibilityChange() {
  if (document.visibilityState === 'visible') {
    if (currentActiveOrders.length > 0) {
      await requestWakeLock();
    }
  } else {
    if (wakeLock) {
      try {
        await wakeLock.release();
      } catch (e) {}
      wakeLock = null;
    }
  }
}

function setupOrdersListener(user) {
  // Listen to shared in-memory active orders stream if delivery panel is mounted
  if (!window._driverOrdersSyncBound) {
    window._driverOrdersSyncBound = true;
    window.addEventListener('driver-active-orders-sync', (e) => {
      if (Array.isArray(e.detail)) {
        currentActiveOrders = e.detail;
        const isOnline = getState().user?.isOnline === true;
        if (currentActiveOrders.length > 0 || isOnline) {
          startWatching();
        } else {
          stopWatching();
        }
        // If we received synced orders from active panel, stop duplicate standalone listener to save Firebase quota
        if (activeOrdersUnsub) {
          try { activeOrdersUnsub(); } catch(e) {}
          activeOrdersUnsub = null;
        }
      }
    });
  }

  // If panel is already active, don't open duplicate Firestore query
  if (window.isDeliveryPanelActive && window.activeOrdersList) {
    currentActiveOrders = window.activeOrdersList;
    return;
  }

  if (activeOrdersUnsub) return; // Already listening

  console.log('Background Tracking: Setting up fallback orders listener for driver:', user.uid);

  const q = query(
    collection(db, 'orders'),
    where('driverId', '==', user.uid),
    where('status', 'in', [
      'accepted', 'aceptado',
      'confirmed', 'confirmado',
      'preparing', 'preparando',
      'ready', 'listo',
      'picked_up', 'retirado',
      'at_door', 'en puerta',
      'delivering', 'en camino'
    ])
  );

  activeOrdersUnsub = onSnapshot(q, (snap) => {
    // If delivery panel mounted in the meantime, detach duplicate
    if (window.isDeliveryPanelActive) {
      if (activeOrdersUnsub) {
        try { activeOrdersUnsub(); } catch(e) {}
        activeOrdersUnsub = null;
      }
      return;
    }
    currentActiveOrders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    console.log(`Background Tracking: Active orders updated. Count: ${currentActiveOrders.length}`);
    
    const isOnline = getState().user?.isOnline === true;
    if (currentActiveOrders.length > 0 || isOnline) {
      startWatching();
    } else {
      stopWatching();
    }
  }, (err) => {
    console.error('Background Tracking: Firestore orders listener failed:', err);
  });
}

async function requestWakeLock() {
  if (document.visibilityState !== 'visible') {
    console.log('Background Tracking: Skipping Wake Lock because tab is not visible.');
    return;
  }
  if ('wakeLock' in navigator && !wakeLock) {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      console.log('Background Tracking: Wake Lock active');
      wakeLock.addEventListener('release', () => {
        console.log('Background Tracking: Wake Lock released');
        wakeLock = null;
      });
    } catch (err) {
      console.warn('WakeLock failed:', err.message);
    }
  }
}

let lastFirestoreWriteTime = 0;
let lastFirestoreWriteCoords = null;

async function handleLocationUpdate(pos) {
  if (!pos || !pos.coords) return;

  const { latitude, longitude, heading } = pos.coords;
  lastLocationUpdateTime = Date.now();
  
  // Cache position in global window context for instant access across modals/maps
  window.lastRiderPos = { lat: latitude, lng: longitude };
  
  // Dispatch custom window event so in-memory UI updates smoothly with 0 network calls
  window.dispatchEvent(new CustomEvent('driver-location-update', {
    detail: {
      coords: { lat: latitude, lng: longitude },
      heading: heading || 0,
      timestamp: lastLocationUpdateTime
    }
  }));

  // Automatic Geofencing Evaluation
  let geofenceTriggeredThisTick = false;
  let minDist = 999999;

  if (!window.triggeredGeofences) window.triggeredGeofences = {};

  for (const o of currentActiveOrders) {
    const orderGeofenceKey = o.id;
    if (!window.triggeredGeofences[orderGeofenceKey]) {
      window.triggeredGeofences[orderGeofenceKey] = { commerce: false, customer: false };
    }

    // 1. Check distance to commerce (<= 80m)
    if (o.pickupCoords || o.comercioCoords) {
      const pCoords = o.pickupCoords || o.comercioCoords;
      const distToCommerce = getHaversineDistance(latitude, longitude, pCoords.lat, pCoords.lng);
      if (distToCommerce < minDist) minDist = distToCommerce;

      if (!window.triggeredGeofences[orderGeofenceKey].commerce) {
        if (distToCommerce <= 80) {
          window.triggeredGeofences[orderGeofenceKey].commerce = true;
          geofenceTriggeredThisTick = true;
          console.log(`[Geofencing] Driver arrived at commerce for order ${o.id} (${Math.round(distToCommerce)}m).`);
        }
      }
    }

    // 2. Check distance to customer (<= 100m)
    if (o.deliveryCoords) {
      const distToCustomer = getHaversineDistance(latitude, longitude, o.deliveryCoords.lat, o.deliveryCoords.lng);
      if (distToCustomer < minDist) minDist = distToCustomer;

      if (!window.triggeredGeofences[orderGeofenceKey].customer) {
        if (distToCustomer <= 100) {
          window.triggeredGeofences[orderGeofenceKey].customer = true;
          geofenceTriggeredThisTick = true;
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
  }

  // High-precision adaptive real-time tracking (Battery & Network Optimized)
  const now = Date.now();
  const speedKmh = (typeof pos.coords.speed === 'number' && pos.coords.speed >= 0) ? pos.coords.speed * 3.6 : -1;
  const hasActiveTrips = currentActiveOrders.length > 0;
  
  let distMoved = 0;
  if (lastFirestoreWriteCoords) {
    distMoved = getHaversineDistance(latitude, longitude, lastFirestoreWriteCoords.lat, lastFirestoreWriteCoords.lng);
  }
  
  const isMoving = speedKmh > 2.5 || distMoved > 5.0;

  // Dynamic interval based on movement and trip urgency
  let timeThreshold = 3500; // 3.5s while in active transit
  let distanceThreshold = 4.0; // 4 meters

  if (!hasActiveTrips) {
    // Idle driver waiting for orders: aggressive battery saving
    timeThreshold = isMoving ? 8000 : 25000; // 8s if cruising, 25s if parked
    distanceThreshold = 12.0;
  } else if (!isMoving) {
    // Stopped at traffic light or waiting inside restaurant
    timeThreshold = 16000; // 16s heartbeat while stationary
    distanceThreshold = 4.0;
  } else if (minDist > 3000) {
    // Cruising far from target
    timeThreshold = 4500;
    distanceThreshold = 7.0;
  }

  let shouldUpdate = false;
  const timeElapsed = now - lastFirestoreWriteTime;

  if (!lastFirestoreWriteCoords || geofenceTriggeredThisTick) {
    shouldUpdate = true;
  } else {
    if (distMoved >= distanceThreshold && timeElapsed >= timeThreshold) {
      shouldUpdate = true;
    } else if (distMoved >= 20.0) {
      // Significant position change
      shouldUpdate = true;
    } else if (timeElapsed >= (hasActiveTrips ? 18000 : 35000)) {
      // Periodic heartbeat even when stationary
      shouldUpdate = true;
    }
  }

  if (!shouldUpdate) {
    return;
  }

  console.log(`Background Tracking (Adaptive): Updating Firestore [${latitude}, ${longitude}] (speed: ${speedKmh.toFixed(1)} km/h, moved: ${distMoved.toFixed(1)}m).`);
  lastFirestoreWriteTime = now;
  lastFirestoreWriteCoords = { lat: latitude, lng: longitude };

  const updates = currentActiveOrders.map(o => {
    return updateDoc(doc(db, 'orders', o.id), {
      driverLocation: {
        lat: latitude,
        lng: longitude,
        updatedAt: serverTimestamp()
      }
    });
  });

  // Only update driver user profile currentLocation when driver is IDLE or on a 60s throttle
  // to eliminate redundant dual-writes while navigating active orders
  const currentUser = getState().user;
  const isIdle = currentActiveOrders.length === 0;
  const lastUserWriteTime = window._lastDriverUserLocationWriteTime || 0;

  if (currentUser && currentUser.uid && (isIdle || (now - lastUserWriteTime > 60000))) {
    window._lastDriverUserLocationWriteTime = now;
    updates.push(updateDoc(doc(db, 'users', currentUser.uid), {
      currentLocation: {
        lat: latitude,
        lng: longitude,
        updatedAt: serverTimestamp()
      }
    }).catch(err => console.warn('Failed to update driver user location:', err)));
  }

  try {
    await Promise.all(updates);
  } catch (err) {
    console.error('Background Tracking: Failed to update order locations in Firestore:', err);
  }
}

// Silent Audio Keep-Alive for iOS Safari / PWA background GPS tracking
let silentAudioEl = null;

function startSilentAudioKeepAlive() {
  try {
    if (!silentAudioEl) {
      const silentMp3Uri = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAP8A';
      silentAudioEl = new Audio(silentMp3Uri);
      silentAudioEl.loop = true;
      silentAudioEl.volume = 0.01;
    }
    
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: 'GO! Repartidor Activo',
        artist: 'Ubicación en tiempo real',
        album: 'GO Delivery'
      });
    }

    const promise = silentAudioEl.play();
    if (promise !== undefined) {
      promise.then(() => {
        console.log('Background Tracking: Silent audio keep-alive active for iOS PWA background GPS tracking.');
      }).catch(err => {
        console.warn('Background Tracking: Silent audio play deferred until interaction:', err);
      });
    }
  } catch (err) {
    console.warn('Background Tracking: Silent audio setup error:', err);
  }
}

function stopSilentAudioKeepAlive() {
  if (silentAudioEl) {
    try {
      silentAudioEl.pause();
      silentAudioEl.currentTime = 0;
    } catch (e) {}
    silentAudioEl = null;
  }
}

async function startWatching() {
  if (locationWatchId || nativeWatcherId) return; // Already tracking
  startSilentAudioKeepAlive();

  if (Capacitor.isNativePlatform() && BackgroundGeolocation) {
    console.log('Background Tracking: Starting NATIVE background geolocation watcher...');
    try {
      const permStatus = await Geolocation.checkPermissions();
      if (permStatus.location !== 'granted') {
        console.log('Background Tracking: Requesting foreground location permissions...');
        await Geolocation.requestPermissions();
      }

      nativeWatcherId = await BackgroundGeolocation.addWatcher({
        backgroundMessage: "Rastreando ubicación para la entrega del pedido.",
        backgroundTitle: "GO! Repartidor Activo",
        requestPermissions: true,
        stale: false,
        distanceFilter: 2
      }, async (location, error) => {
        if (error) {
          console.error('Background Tracking Native Error:', error);
          return;
        }
        const pos = { coords: { latitude: location.latitude, longitude: location.longitude } };
        
        await handleLocationUpdate(pos);
      });
      return; // Skip web fallback
    } catch (err) {
      console.error('Failed to start native background geolocation:', err);
      // Fallback to web below
    }
  }

  if (!navigator.geolocation) {
    console.error('Background Tracking: Geolocation not supported by this browser');
    return;
  }

  console.log('Background Tracking: Starting WEB location watch sensor...');
  await requestWakeLock();

  lastLocationUpdateTime = Date.now();
  
  const geoOptions = {
    enableHighAccuracy: true,
    maximumAge: 0, // Force instant fresh GPS hardware reading
    timeout: 10000
  };

  const onGeoSuccess = handleLocationUpdate;

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
  stopWatching();
  if (errorRetryTimeout) {
    clearTimeout(errorRetryTimeout);
    errorRetryTimeout = null;
  }
  startWatching();
}

function stopWatching() {
  console.log('Background Tracking: Deactivating active geolocation sensors and timers...');
  stopSilentAudioKeepAlive();
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
