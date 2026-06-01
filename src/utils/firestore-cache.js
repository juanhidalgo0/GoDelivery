import { getDocsFromServer, getDocsFromCache } from 'firebase/firestore';

/**
 * Executes a Firestore query with smart caching based on local metadata.
 * Saves server read operations and provides near-instant load times.
 * Falls back to cache if offline or server fails.
 * 
 * @param {Query} queryRef Firestore query object
 * @param {string} cacheKey Unique string identifying this query type (e.g. 'platformCategories')
 * @param {number} ttlMs Time to live in milliseconds (default 5 minutes)
 * @returns {Promise<QuerySnapshot>}
 */
export async function getDocsOptimized(queryRef, cacheKey, ttlMs = 5 * 60 * 1000) {
  const now = Date.now();
  const cacheMetaKey = `gd_cache_meta_${cacheKey}`;
  const cachedMeta = localStorage.getItem(cacheMetaKey);
  
  let isFresh = false;
  if (cachedMeta) {
    try {
      const meta = JSON.parse(cachedMeta);
      if (now - meta.timestamp < ttlMs) {
        isFresh = true;
      }
    } catch (e) {
      localStorage.removeItem(cacheMetaKey);
    }
  }

  // 1. If cache is fresh, try loading from cache first
  if (isFresh) {
    try {
      const cachedSnap = await getDocsFromCache(queryRef);
      if (!cachedSnap.empty) {
        console.log(`[FirestoreCache] Loaded '${cacheKey}' from CACHE (fresh). size: ${cachedSnap.size}`);
        return cachedSnap;
      }
    } catch (err) {
      console.warn(`[FirestoreCache] Failed to load '${cacheKey}' from cache, falling back to server:`, err);
    }
  }

  // 2. Load from server (either because cache is stale, missing, or getDocsFromCache returned empty)
  try {
    const serverSnap = await getDocsFromServer(queryRef);
    console.log(`[FirestoreCache] Loaded '${cacheKey}' from SERVER. size: ${serverSnap.size}`);
    
    // Save metadata timestamp to localStorage to mark cache as fresh
    localStorage.setItem(cacheMetaKey, JSON.stringify({ timestamp: now }));
    return serverSnap;
  } catch (serverErr) {
    console.warn(`[FirestoreCache] Server query failed for '${cacheKey}'. Checking offline cache fallback:`, serverErr);
    
    // 3. Offline fallback: if server is unreachable, try to load whatever is in the cache (even if stale)
    try {
      const cachedSnap = await getDocsFromCache(queryRef);
      console.log(`[FirestoreCache] Offline fallback successful for '${cacheKey}' from CACHE. size: ${cachedSnap.size}`);
      return cachedSnap;
    } catch (cacheErr) {
      // Re-throw original server error if cache is also broken/empty
      throw serverErr;
    }
  }
}

/**
 * Automatically cleans up cached Firestore query metadata from localStorage
 * if they are older than 24 hours (86,400,000 ms).
 */
export function evictExpiredCache() {
  const now = Date.now();
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  const keysToRemove = [];

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('gd_cache_meta_')) {
      try {
        const metaStr = localStorage.getItem(key);
        if (metaStr) {
          const meta = JSON.parse(metaStr);
          if (meta && typeof meta.timestamp === 'number') {
            if (now - meta.timestamp > ONE_DAY_MS) {
              keysToRemove.push(key);
            }
          } else {
            // Invalid metadata format, remove it
            keysToRemove.push(key);
          }
        } else {
          keysToRemove.push(key);
        }
      } catch (err) {
        console.warn(`[FirestoreCache] Failed to parse meta key ${key}, scheduling removal:`, err);
        keysToRemove.push(key);
      }
    }
  }

  keysToRemove.forEach(key => {
    localStorage.removeItem(key);
    console.log(`[FirestoreCache] Evicted expired cache entry: ${key}`);
  });

  if (keysToRemove.length > 0) {
    console.log(`[FirestoreCache] Cleaned up ${keysToRemove.length} expired cache entries from localStorage.`);
  }
}

