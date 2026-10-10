// GoDelivery — Global Background Geolocation Tracking for Delivery Drivers
import { db } from '../firebase.js';
import { recordDriverPosition } from './driver-dwell.js';
import { isPlaceholderCoords } from './mandado-places.js';
import { createGpsFilter } from './gps-filter.js';
import { shouldWriteNatively, nativeWrite } from './native-firestore-write.js';
import { collection, query, where, onSnapshot, doc, updateDoc, setDoc, serverTimestamp } from 'firebase/firestore';
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
let lastLocationUpdateTime = 0; // last reading from the sensor, good or discarded (the watchdog uses it)
let watchdogInterval = null;
let heartbeatInterval = null;
// Every reading goes through the filter (bad-accuracy points, impossible jumps, jitter while
// standing still). lastGoodFix is the last point it let through and when it arrived.
const gpsFilter = createGpsFilter();
let lastGoodFix = null;

// With orders in progress the customer's map treats a position older than ~90s as "no signal".
// The native watcher only reports on movement (distanceFilter), so a driver waiting at the
// counter went silent and showed as offline. Every HEARTBEAT_MS we ask for a fresh fix; if the
// GPS can't give one, the last fix is re-sent while it's recent (the driver is standing still).
const HEARTBEAT_MS = 20000;
const HEARTBEAT_MAX_FIX_AGE_MS = 3 * 60 * 1000;

// While moving with an order, one position every ~2s: the customer's map replays the route with
// a buffer of about one interval, so a steadier and shorter interval is a smoother, closer moto.
const LIVE_MOVING_MS = 2000;
const LIVE_FAR_MS = 3000;       // more than 3 km from the next stop
const LIVE_STILL_MS = 15000;    // standing still (plus the heartbeat)

// The native watcher's distanceFilter. With an order in progress it is 0: the phone keeps
// reporting even when the driver doesn't move, which is what keeps the position fresh with the
// screen locked (iOS suspends the JS, so the heartbeat below can't run; only the plugin's own
// callbacks wake it). Without orders, 2 m as before, to save battery while waiting.
const nativeDistanceFilter = () => (currentActiveOrders.length > 0 ? 0 : 2);
let nativeWatcherFilter = null;

// fixAt (GPS reading time) and accuracy need the new firestore.rules. Until they're published the
// write is rejected; then it falls back to the old fields for the rest of the session.
let liveExtraFields = true;

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
    // Back from the background: a browser GPS watch the OS froze doesn't always wake up by itself
    if (locationWatchId && Date.now() - lastLocationUpdateTime > 10000) restartWebWatch();
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
          startWatching().then(syncNativeWatcherFilter);
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
      startWatching().then(syncNativeWatcherFilter);
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
const lastOrderDocLocationWrite = new Map(); // orderId -> ms of the last driverLocation write on the order doc
let lastFirestoreWriteCoords = null;

// Every GPS reading (native watcher, browser watch, heartbeat) comes in here. Returns true if the
// filter let it through.
async function onRawFix(raw, opts = {}) {
  lastLocationUpdateTime = Date.now(); // the sensor is alive, even if this point gets discarded
  const { fix, reason } = gpsFilter.push(raw);
  if (!fix) {
    if (reason === 'imprecise' || reason === 'jump') console.debug(`Background Tracking: GPS point discarded (${reason})`);
    return false;
  }
  lastGoodFix = { fix, at: Date.now() };
  await handleLocationUpdate(fix, opts);
  return true;
}

// fix: filtered point { lat, lng, accuracy, time, speed, heading, moving } (utils/gps-filter.js).
// opts.force: write it now whatever the thresholds say. opts.resend: the heartbeat repeating the
// last point because the GPS gave nothing new (it keeps its reading time).
async function handleLocationUpdate(fix, opts = {}) {
  if (!fix) return;
  const { lat: latitude, lng: longitude } = fix;
  const speed = Number.isFinite(fix.speed) && fix.speed >= 0 ? fix.speed : 0;
  const heading = Number.isFinite(fix.heading) ? fix.heading : 0;

  // Cache position in global window context for instant access across modals/maps
  window.lastRiderPos = { lat: latitude, lng: longitude };
  if (!opts.resend) window.lastRiderPosAt = Date.now();
  window.lastRiderAccuracy = Number.isFinite(fix.accuracy) ? fix.accuracy : null;
  recordDriverPosition(latitude, longitude, window.lastRiderAccuracy); // para detectar dónde se quedó comprando

  const tickDetail = {
    coords: { lat: latitude, lng: longitude, speed },
    heading,
    speed: speed * 3.6,
    timestamp: fix.time
  };

  // Dispatch live in-memory events so navigation map & telemetry update with zero latency
  // (only 'driver-location-tick': the map listened to 'driver-location-update' too and redrew twice)
  window.dispatchEvent(new CustomEvent('driver-location-tick', { detail: tickDetail }));
  window.dispatchEvent(new CustomEvent('driver-speed-update', { detail: { speedKmh: Math.round(tickDetail.speed) } }));

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
    const pCoords = o.comercioCoords || (isPlaceholderCoords(o.pickupCoords) ? null : o.pickupCoords);
    if (pCoords && typeof pCoords.lat === 'number' && typeof pCoords.lng === 'number') {
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
  const hasActiveTrips = currentActiveOrders.length > 0;

  let distMoved = 0;
  if (lastFirestoreWriteCoords) {
    distMoved = getHaversineDistance(latitude, longitude, lastFirestoreWriteCoords.lat, lastFirestoreWriteCoords.lng);
  }

  // The filter pins the position while standing still, so any distance here is real movement
  const isMoving = fix.moving || distMoved >= 3;

  // Dynamic interval based on movement and trip urgency (Battery & Network Saver)
  let timeThreshold = LIVE_MOVING_MS;
  let distanceThreshold = 2.0;

  if (!hasActiveTrips) {
    // Idle driver waiting for orders: aggressive battery saving
    timeThreshold = isMoving ? 10000 : 35000; // 10s if cruising, 35s if parked
    distanceThreshold = 15.0;
  } else if (!isMoving) {
    // Stopped at a traffic light or waiting inside the shop
    timeThreshold = LIVE_STILL_MS;
    distanceThreshold = 0;
  } else if (minDist > 3000) {
    // Cruising far from target (>3km)
    timeThreshold = LIVE_FAR_MS;
    distanceThreshold = 4.0;
  }

  let shouldUpdate = false;
  const timeElapsed = now - lastFirestoreWriteTime;

  if (!lastFirestoreWriteCoords || geofenceTriggeredThisTick || opts.force) {
    shouldUpdate = true;
  } else {
    if (distMoved >= distanceThreshold && timeElapsed >= timeThreshold) {
      shouldUpdate = true;
    } else if (distMoved >= 25.0 && timeElapsed >= 1000) {
      // Significant position change
      shouldUpdate = true;
    } else if (timeElapsed >= (hasActiveTrips ? LIVE_STILL_MS : 45000)) {
      // Periodic heartbeat even when stationary
      shouldUpdate = true;
    }
  }

  if (!shouldUpdate) {
    return;
  }

  lastFirestoreWriteTime = now;
  lastFirestoreWriteCoords = { lat: latitude, lng: longitude };

  // Every tick goes to orders/{id}/live/driver, which the customer's map listens to. The order
  // doc itself only gets the position every 30s (panels and the WhatsApp page still read it):
  // writing it every few seconds fired the onOrderStatusChange Cloud Function on every GPS point.
  // fixAt is when the GPS took the reading: the customer's map spaces the movement with it, not
  // with when each write happened to arrive.
  const livePos = { lat: latitude, lng: longitude, heading, speed, updatedAt: serverTimestamp() };
  // App de Android fuera de pantalla: por la red nativa (ver utils/native-firestore-write.js)
  const viaNative = shouldWriteNatively();
  const updates = currentActiveOrders.flatMap(o => {
    const writes = [writeLivePosition(o.id, livePos, fix, viaNative)];

    const lastOrderWrite = lastOrderDocLocationWrite.get(o.id) || 0;
    if (now - lastOrderWrite >= 30000 || geofenceTriggeredThisTick) {
      lastOrderDocLocationWrite.set(o.id, now);
      const sdkWrite = () => updateDoc(doc(db, 'orders', o.id), {
        driverLocation: {
          lat: latitude,
          lng: longitude,
          updatedAt: serverTimestamp()
        }
      });
      writes.push(viaNative
        ? nativeWrite(`orders/${o.id}`, { driverLocation: { lat: latitude, lng: longitude } }, { merge: ['driverLocation'], serverTime: ['driverLocation.updatedAt'] })
          .catch((err) => { console.warn('Background Tracking: native order write failed, using the SDK:', err?.message || err); return sdkWrite(); })
        : sdkWrite());
    }
    return writes;
  });

  // Only update driver user profile currentLocation when driver is IDLE or on a 60s throttle
  // to eliminate redundant dual-writes while navigating active orders
  const currentUser = getState().user;
  const isIdle = currentActiveOrders.length === 0;
  const lastUserWriteTime = window._lastDriverUserLocationWriteTime || 0;

  if (currentUser && currentUser.uid && (isIdle || (now - lastUserWriteTime > 60000))) {
    window._lastDriverUserLocationWriteTime = now;
    const sdkWrite = () => updateDoc(doc(db, 'users', currentUser.uid), {
      currentLocation: {
        lat: latitude,
        lng: longitude,
        updatedAt: serverTimestamp()
      }
    });
    const userWrite = viaNative
      ? nativeWrite(`users/${currentUser.uid}`, { currentLocation: { lat: latitude, lng: longitude } }, { merge: ['currentLocation'], serverTime: ['currentLocation.updatedAt'] })
        .catch((err) => { console.warn('Background Tracking: native user write failed, using the SDK:', err?.message || err); return sdkWrite(); })
      : sdkWrite();
    updates.push(userWrite.catch(err => console.warn('Failed to update driver user location:', err)));
  }

  // Not awaited: offline, the writes stay queued until the connection comes back
  Promise.all(updates).catch(err => {
    console.error('Background Tracking: Failed to update order locations in Firestore:', err);
  });
}

function writeLivePosition(orderId, livePos, fix, viaNative = false) {
  if (viaNative) {
    const fields = { lat: livePos.lat, lng: livePos.lng, heading: livePos.heading, speed: livePos.speed };
    if (Number.isFinite(fix.time)) fields.fixAt = fix.time;
    if (Number.isFinite(fix.accuracy)) fields.accuracy = fix.accuracy;
    return nativeWrite(`orders/${orderId}/live/driver`, fields, { serverTime: ['updatedAt'] })
      .catch((err) => {
        console.warn('Background Tracking: native live write failed, using the SDK:', err?.message || err);
        return writeLivePosition(orderId, livePos, fix, false);
      });
  }
  const ref = doc(db, 'orders', orderId, 'live', 'driver');
  if (!liveExtraFields) {
    return setDoc(ref, livePos).catch(err => console.warn('Failed to write live driver location:', err));
  }
  return setDoc(ref, { ...livePos, fixAt: fix.time, accuracy: fix.accuracy }).catch(async (err) => {
    if (err?.code !== 'permission-denied') {
      console.warn('Failed to write live driver location:', err);
      return;
    }
    // Rules without fixAt/accuracy yet (or the order is no longer this driver's): try the old fields
    try {
      await setDoc(ref, livePos);
      liveExtraFields = false;
    } catch (e) {
      console.warn('Failed to write live driver location:', e);
    }
  });
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

// Keeps the customer's map fed while the driver stands still (see HEARTBEAT_MS).
async function heartbeatTick() {
  if (currentActiveOrders.length === 0) return;
  if (Date.now() - lastFirestoreWriteTime < HEARTBEAT_MS) return;
  try {
    const fresh = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 8000, maximumAge: 5000 });
    // Force the write: a still driver doesn't pass the movement thresholds.
    if (fresh?.coords && await onRawFix(fresh, { force: true })) return;
  } catch (err) {
    console.warn('Background Tracking Heartbeat: no fresh fix:', err?.message || err);
  }
  // No fresh reading: re-send the last good one while it's recent (standing still, weak GPS
  // indoors). Its age counts from when it was read, not from the last re-send: before, every
  // re-send made it "new" again and a phone that lost the GPS showed EN VIVO forever.
  if (lastGoodFix && Date.now() - lastGoodFix.at < HEARTBEAT_MAX_FIX_AGE_MS) {
    await handleLocationUpdate(lastGoodFix.fix, { force: true, resend: true });
  }
}

function startHeartbeat() {
  if (heartbeatInterval) return;
  heartbeatInterval = setInterval(() => { heartbeatTick().catch(() => {}); }, HEARTBEAT_MS);
}

function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

let watchStarting = false;

async function startWatching() {
  if (locationWatchId != null || nativeWatcherId || watchStarting) return; // Already tracking (or starting)
  watchStarting = true;
  try {
    await startWatchingNow();
  } finally {
    watchStarting = false;
  }
}

async function startWatchingNow() {
  startSilentAudioKeepAlive();
  startHeartbeat();

  if (Capacitor.isNativePlatform() && BackgroundGeolocation) {
    console.log('Background Tracking: Starting NATIVE background geolocation watcher...');
    try {
      const permStatus = await Geolocation.checkPermissions();
      if (permStatus.location !== 'granted') {
        console.log('Background Tracking: Requesting foreground location permissions...');
        await Geolocation.requestPermissions();
      }

      await addNativeWatcher();
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
  startWebWatch();

  // 4. Watchdog Timer: Wake up the GPS sensor if background throttling froze the watchPosition callback
  if (!watchdogInterval) {
    watchdogInterval = setInterval(() => {
      const elapsed = Date.now() - lastLocationUpdateTime;
      if (currentActiveOrders.length > 0 && elapsed > 25000) {
        console.warn(`Background Tracking Watchdog: GPS sensor inactive for ${Math.round(elapsed / 1000)}s with active orders! Reviving sensor...`);
        restartWebWatch();
      }
    }, 15000); // Check every 15 seconds
  }
}

async function addNativeWatcher() {
  const distanceFilter = nativeDistanceFilter();
  nativeWatcherId = await BackgroundGeolocation.addWatcher({
    backgroundMessage: "Rastreando ubicación para la entrega del pedido.",
    backgroundTitle: "GO! Repartidor Activo",
    requestPermissions: true,
    stale: false,
    distanceFilter
  }, (location, error) => {
    // On error the plugin calls back with no location (it used to throw here)
    if (error || !location) {
      if (error) console.warn('Background Tracking: native watcher error:', error?.code || error?.message || error);
      return;
    }
    // Brings accuracy and the reading time too: the filter and the customer's map use them
    onRawFix(location).catch(err => console.warn('Background Tracking: location update failed:', err));
  });
  nativeWatcherFilter = distanceFilter;
}

// An order came in or the last one ended: the native watcher switches distanceFilter (see
// nativeDistanceFilter). The plugin can't change it on a running watcher, so it is replaced.
let filterSyncing = false;
async function syncNativeWatcherFilter() {
  if (!nativeWatcherId || !BackgroundGeolocation || filterSyncing) return;
  if (nativeWatcherFilter === nativeDistanceFilter()) return;
  filterSyncing = true;
  const oldId = nativeWatcherId;
  try {
    await addNativeWatcher(); // the new one first, so there's no gap without GPS
    await BackgroundGeolocation.removeWatcher({ id: oldId }).catch(() => {});
  } catch (err) {
    console.warn('Background Tracking: could not switch the native watcher:', err);
    nativeWatcherId = oldId;
  } finally {
    filterSyncing = false;
  }
}

function startWebWatch() {
  const geoOptions = {
    enableHighAccuracy: true,
    maximumAge: 0, // Force instant fresh GPS hardware reading
    timeout: 20000
  };
  // A timeout or a moment without signal doesn't end the watch: it keeps going and the next
  // reading arrives by itself. Restarting it on every error (as before) also tore down the silent
  // audio that keeps the iPhone PWA alive in the background, and that's what cut the tracking.
  const onGeoError = (err) => console.warn(`Background Tracking Watch Error (Code ${err.code}): ${err.message}`);
  locationWatchId = navigator.geolocation.watchPosition(
    (pos) => { onRawFix(pos).catch(err => console.warn('Background Tracking: location update failed:', err)); },
    onGeoError,
    geoOptions
  );
}

// Only the browser's GPS watch: the heartbeat, the wake lock and the silent audio stay on.
function restartWebWatch() {
  if (locationWatchId == null || !navigator.geolocation) return;
  console.log('Background Tracking: Restarting the browser GPS watch...');
  navigator.geolocation.clearWatch(locationWatchId);
  lastLocationUpdateTime = Date.now();
  startWebWatch();
}

function stopWatching() {
  console.log('Background Tracking: Deactivating active geolocation sensors and timers...');
  stopSilentAudioKeepAlive();
  stopHeartbeat();
  if (locationWatchId != null) {
    navigator.geolocation.clearWatch(locationWatchId);
    locationWatchId = null;
  }
  // The native watcher used to stay on after the last order (battery) and, since its id was
  // never cleared, startWatching() could never start a new one.
  if (nativeWatcherId && BackgroundGeolocation) {
    const id = nativeWatcherId;
    nativeWatcherId = null;
    BackgroundGeolocation.removeWatcher({ id }).catch((err) => console.warn('Background Tracking: removeWatcher failed:', err));
    nativeWatcherFilter = null;
  }
  if (wakeLock) {
    wakeLock.release().then(() => wakeLock = null).catch(() => {});
  }
  if (watchdogInterval) {
    clearInterval(watchdogInterval);
    watchdogInterval = null;
  }
  // The next shift starts clean (a point from the last one shouldn't count as "recent")
  gpsFilter.reset();
  lastGoodFix = null;
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
