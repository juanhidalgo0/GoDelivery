// GoDelivery — Dynamic Cleanup Registry
let activeListeners = [];

/**
 * Registers an unsubscribe function (like from onSnapshot or addEventListener).
 * @param {Function} unsub 
 */
export function registerUnsubscribe(unsub) {
  if (typeof unsub === 'function') {
    activeListeners.push(unsub);
  }
}

/**
 * Dispatches all registered unsubscribe methods and clears the list.
 */
export function clearActiveListeners() {
  if (activeListeners.length > 0) {
    console.log(`[Cleanup] Clearing ${activeListeners.length} active listeners...`);
  }
  activeListeners.forEach(unsub => {
    try {
      unsub();
    } catch (e) {
      console.warn('[Cleanup] Error running unsubscribe:', e);
    }
  });
  activeListeners = [];
}
