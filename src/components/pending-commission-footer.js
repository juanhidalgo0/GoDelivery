import { db } from '../firebase.js';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { icon } from '../utils/icons.js';
import { formatPrice } from '../utils/format.js';

export async function renderPendingCommissionStickyFooter(comercioId, parentEl) {
  if (!comercioId || !parentEl) return;

  try {
    const ordersSnap = await getDocs(query(
      collection(db, 'orders'),
      where('comercioId', '==', comercioId),
      where('status', '==', 'completed')
    ));

    const completedOrders = ordersSnap.docs.map(d => d.data());
    const pendingAmount = completedOrders.reduce((sum, o) => {
      const isPending = !o.commissionStatus || o.commissionStatus === 'pending';
      return sum + (isPending ? (o.commissionAmount || 0) : 0);
    }, 0);

    const existingFooter = parentEl.querySelector('.pending-commission-sticky-footer');
    if (existingFooter) existingFooter.remove();

    const footer = document.createElement('div');
    footer.className = 'pending-commission-sticky-footer';
    footer.style.cssText = `
      position: relative;
      width: 100%;
      background: var(--color-primary);
      color: white;
      padding: 10px 18px calc(10px + env(safe-area-inset-bottom, 0px)) 18px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      z-index: 100;
      border-top: 1px solid rgba(255,255,255,0.15);
      box-shadow: 0 -4px 15px rgba(225,29,72,0.25);
      flex-shrink: 0;
      margin-top: auto;
    `;

    footer.innerHTML = `
      <div style="display: flex; align-items: center; gap: 10px;">
        <div style="width: 34px; height: 34px; border-radius: 10px; background: rgba(255,255,255,0.2); color: white; display: flex; align-items: center; justify-content: center; border: 1px solid rgba(255,255,255,0.3); flex-shrink: 0;">
          ${icon('zap', 18)}
        </div>
        <div style="display: flex; flex-direction: column;">
          <span style="font-size: 9.5px; font-weight: 850; text-transform: uppercase; letter-spacing: 0.6px; color: rgba(255,255,255,0.85);">Comisión Pendiente</span>
          <span style="font-size: 16px; font-weight: 900; color: white; font-family: var(--font-display); line-height: 1.1;">${formatPrice(pendingAmount)}</span>
        </div>
      </div>
      <a href="#/mi-comercio/${comercioId}/finances" style="background: white; color: var(--color-primary); text-decoration: none; padding: 8px 16px; border-radius: 10px; font-size: 12px; font-weight: 900; display: inline-flex; align-items: center; gap: 5px; box-shadow: 0 2px 8px rgba(0,0,0,0.15); transition: transform 0.2s;" onmouseover="this.style.transform='scale(1.03)'" onmouseout="this.style.transform='scale(1)'">
        <span>Finanzas</span>
        ${icon('chevronRight', 14)}
      </a>
    `;

    parentEl.appendChild(footer);
  } catch (err) {
    console.error('Error rendering pending commission sticky footer:', err);
  }
}
