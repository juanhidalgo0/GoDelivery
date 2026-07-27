// SafeStorage wrapper for localStorage to handle QuotaExceededError and auto-purge stale cache items

export const safeStorage = {
  getItem(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  },

  setItem(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      if (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014) {
        console.warn(`[SafeStorage] QuotaExceededError on key '${key}'. Purging old cache keys...`);
        this.clearStaleCaches();
        try {
          localStorage.setItem(key, value);
        } catch (retryErr) {
          console.warn(`[SafeStorage] Still exceeded quota after purge for key '${key}'`);
        }
      } else {
        console.error('[SafeStorage] Error setting item:', e);
      }
    }
  },

  removeItem(key) {
    try {
      localStorage.removeItem(key);
    } catch (e) {}
  },

  clearStaleCaches() {
    try {
      // Keys that are safe to purge when local storage is full
      const purgeablePrefixes = [
        'gd_cache_meta_',
        'gd_comercio_cache_',
        'gd_cached_',
        'gd_dismissed_'
      ];

      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && purgeablePrefixes.some(prefix => k.startsWith(prefix))) {
          keysToRemove.push(k);
        }
      }

      keysToRemove.forEach(k => localStorage.removeItem(k));
      console.log(`[SafeStorage] Purged ${keysToRemove.length} stale cache keys from localStorage.`);
    } catch (e) {
      console.error('[SafeStorage] Error clearing stale caches:', e);
    }
  }
};
