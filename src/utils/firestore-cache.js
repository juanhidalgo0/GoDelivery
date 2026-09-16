import { getDocs, getDocsFromServer, getDocsFromCache } from 'firebase/firestore';
import { safeStorage } from './safe-storage.js';

const DEFAULT_QUERY_TIMEOUT_MS = 8000;

export function withTimeout(promise, ms, label) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`Timeout after ${ms}ms: ${label}`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

/**
 * Executes a Firestore query with smart caching based on local metadata.
 * Saves server read operations and provides near-instant load times.
 * Falls back to cache if offline or server fails.
 *
 * @param {Query} queryRef Firestore query object
 * @param {string} cacheKey Unique string identifying this query type (e.g. 'platformCategories')
 * @param {number} ttlMs Time to live in milliseconds (default 5 minutes)
 * @param {number} timeoutMs Max time to wait for a server response before giving up (default 8s)
 * @returns {Promise<QuerySnapshot & {error?: boolean}>}
 */
export async function getDocsOptimized(queryRef, cacheKey, ttlMs = 5 * 60 * 1000, timeoutMs = DEFAULT_QUERY_TIMEOUT_MS) {
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
        return cachedSnap;
      }
    } catch (err) {
      // Cache miss or expired, proceed to fetch
    }
  }

  // 2. Fetch using standard getDocs (supports online & smart persistence),
  // bounded by a timeout so a slow/stuck connection can't hang the page forever.
  try {
    const snap = await withTimeout(getDocs(queryRef), timeoutMs, cacheKey);
    safeStorage.setItem(cacheMetaKey, JSON.stringify({ timestamp: now }));
    return snap;
  } catch (err) {
    console.warn(`[FirestoreCache] Query failed for '${cacheKey}'. Checking fallback:`, err);
    try {
      const cachedSnap = await getDocsFromCache(queryRef);
      if (!cachedSnap.empty) return cachedSnap;
    } catch (cacheErr) {
      // No usable cache either, fall through to the error snapshot below.
    }
    // Return an empty snapshot but mark it as errored so callers can tell
    // "no data" apart from "query failed" and show a retry option instead
    // of silently rendering an empty page.
    return { empty: true, docs: [], size: 0, forEach: () => {}, error: true };
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

