import { db } from '../firebase.js';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';

/**
 * Returns date formatted as YYYY-MM-DD in the America/Argentina/Buenos_Aires timezone.
 * Uses a robust method that is compatible across modern browsers.
 */
export function getLocalDateString(date = new Date()) {
  try {
    return date.toLocaleDateString('fr-CA', { timeZone: 'America/Argentina/Buenos_Aires' }); // fr-CA format yields YYYY-MM-DD
  } catch (e) {
    // Fallback if timezone is invalid or unsupported
    console.warn('Buenos Aires timezone not supported, falling back to local date:', e);
    const offset = date.getTimezoneOffset();
    const local = new Date(date.getTime() - (offset * 60 * 1000));
    return local.toISOString().split('T')[0];
  }
}

/**
 * Records a unique user visit per day (DAU Telemetry).
 * Deduplicates in localStorage to minimize Firestore write operations.
 */
export async function trackUserVisit(userId) {
  if (!userId) return;
  
  const today = getLocalDateString();
  const lastTracked = localStorage.getItem('gd_last_visit_date');
  
  if (lastTracked === today) {
    // Already tracked today
    return;
  }
  
  try {
    const visitDocId = `${userId}_${today}`;
    const visitRef = doc(db, 'visits', visitDocId);
    
    await setDoc(visitRef, {
      userId,
      date: today,
      timestamp: serverTimestamp()
    }, { merge: true });
    
    localStorage.setItem('gd_last_visit_date', today);
    console.log(`📊 Telemetry: Recorded unique visit for ${today}`);
  } catch (err) {
    console.error('Failed to log unique user visit telemetry:', err);
  }
}
