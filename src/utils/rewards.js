// GoDelivery — Rewards and Gamification Processor
import { db } from '../firebase.js';
import { collection, query, where, getDocs, doc, increment, getDoc } from 'firebase/firestore';
import { showToast } from '../components/toast.js';

/**
 * Process referral benefits and update weekly challenges for a user when their order is marked as delivered/completed.
 * @param {object} batch - Firestore WriteBatch instance
 * @param {string} customerUid - The customer's user UID
 * @param {object} customerData - The customer's user data document *before* current increment
 */
export async function processOrderCompletionRewards(batch, customerUid, customerData) {
  try {
    const nextOrderCount = (customerData.completedOrdersCount || 0) + 1;
    console.log(`[Rewards] Processing rewards for customer ${customerUid}. Completed orders count will be: ${nextOrderCount}`);

    // ==========================================
    // 1. Referral System ("Traé a un amigo")
    // ==========================================
    if (nextOrderCount === 1 && customerData.referredBy && !customerData.referredRewardGranted) {
      const refCode = customerData.referredBy;
      console.log(`[Rewards] User was referred by ${refCode}. Processing rewards...`);
      
      // Find referrer
      const usersRef = collection(db, 'users');
      const q = query(usersRef, where('referralCode', '==', refCode));
      const referrerSnap = await getDocs(q);

      if (!referrerSnap.empty) {
        const referrerDoc = referrerSnap.docs[0];
        const referrerUid = referrerDoc.id;
        
        // Fetch dynamic referral points reward
        const globalSnap = await getDoc(doc(db, 'settings', 'global'));
        const globalData = globalSnap.exists() ? globalSnap.data() : {};
        const refPoints = globalData.referralPoints !== undefined ? Number(globalData.referralPoints) : 500;
        
        console.log(`[Rewards] Found referrer: ${referrerUid}. Rewarding ${refPoints} GO Points to both.`);

        // Reward Referrer
        batch.update(doc(db, 'users', referrerUid), {
          points: increment(refPoints)
        });

        // Reward Customer
        batch.update(doc(db, 'users', customerUid), {
          points: increment(refPoints),
          referredRewardGranted: true
        });

        // Log transaction for referrer
        const refTransRef = doc(collection(db, 'points_transactions'));
        batch.set(refTransRef, {
          userId: referrerUid,
          type: 'referral_bonus',
          points: refPoints,
          description: `¡Tu amigo completó su primer pedido! Bono de referido concedido.`,
          createdAt: new Date()
        });

        // Log transaction for customer
        const custTransRef = doc(collection(db, 'points_transactions'));
        batch.set(custTransRef, {
          userId: customerUid,
          type: 'referred_welcome',
          points: refPoints,
          description: `¡Bono de bienvenida por usar el código de referido de un amigo!`,
          createdAt: new Date()
        });
      } else {
        console.warn(`[Rewards] Referrer with code ${refCode} not found.`);
      }
    }

    // ==========================================
    // 2. Weekly Challenges & Streaks
    // ==========================================
    const challengesRef = collection(db, 'users', customerUid, 'challenges');
    const challengesSnap = await getDocs(challengesRef);

    if (!challengesSnap.empty) {
      challengesSnap.docs.forEach(cDoc => {
        const challenge = cDoc.data();
        if (!challenge.completed) {
          const currentProgress = (challenge.progress || 0) + 1;
          const isCompleted = currentProgress >= challenge.target;
          
          const updateData = {
            progress: currentProgress
          };

          if (isCompleted) {
            updateData.completed = true;
            updateData.completedAt = new Date();
            
            console.log(`[Rewards] Challenge ${cDoc.id} COMPLETED by ${customerUid}! Awarding ${challenge.pointsReward} GO Points.`);

            // Award challenge points
            batch.update(doc(db, 'users', customerUid), {
              points: increment(challenge.pointsReward)
            });

            // Log challenge points transaction
            const challengeTransRef = doc(collection(db, 'points_transactions'));
            batch.set(challengeTransRef, {
              userId: customerUid,
              type: 'challenge_completion',
              points: challenge.pointsReward,
              description: `Completaste el desafío semanal: ${challenge.title}`,
              createdAt: new Date()
            });
          }

          batch.update(doc(db, 'users', customerUid, 'challenges', cDoc.id), updateData);
        }
      });
    }
  } catch (error) {
    console.error('[Rewards] Error in processOrderCompletionRewards:', error);
  }
}
