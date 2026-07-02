// GoDelivery — Unified Completed Order & Rating Component
import { db } from '../firebase.js';
import { doc, updateDoc, arrayUnion, serverTimestamp } from 'firebase/firestore';
import { getState } from '../state.js';
import { showModal, closeModal } from './modal.js';
import { icon } from '../utils/icons.js';
import { showToast } from './toast.js';
import { formatPrice } from '../utils/format.js';

/**
 * Show a rating modal for a delivered order
 * @param {Object} order - The completed order object
 */
export function showDeliveryRating(order) {
  if (!order) return;

  const user = getState().user;
  if (!user || user.uid !== order.userId) return;

  // Prevent double rendering
  if (window[`hasShownRatingModal_${order.id}`]) return;
  window[`hasShownRatingModal_${order.id}`] = true;

  // Local calculation of Go Points (100% instant)
  const completedOrders = user?.completedOrdersCount || 0;
  let multiplier = 1.0;
  let levelName = 'Bronce';
  let levelColor = '#CD7F32';
  let levelId = 'bronce';

  if (completedOrders >= 16) {
    multiplier = 1.5;
    levelName = 'Oro';
    levelColor = '#FFD700';
    levelId = 'oro';
  } else if (completedOrders >= 6) {
    multiplier = 1.25;
    levelName = 'Plata';
    levelColor = '#C0C0C0';
    levelId = 'plata';
  }

  const s = getState();
  const dollarPerPoint = s.dollarPerPoint || 1;
  const baseRate = 0.01; // 1% points rate
  
  // Instant points calculation
  const points = order.pointsEarned !== undefined && order.pointsEarned !== null
    ? order.pointsEarned
    : Math.floor((order.subtotal || order.total || 0) * baseRate * multiplier);

  const valueDiscount = points * dollarPerPoint;

  let selectedRating = 0;

  const modalContent = document.createElement('div');
  modalContent.style.cssText = 'padding: 24px 20px; text-align: center;';

  modalContent.innerHTML = `
    <!-- Top Spacer and Coin Logo -->
    <div style="margin-top: 14px; margin-bottom: 16px;">
      <div class="points-earned-pulse" style="width: 72px; height: 72px; border-radius: 50%; background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: white; display: flex; align-items: center; justify-content: center; box-shadow: 0 8px 24px rgba(245, 158, 11, 0.3); animation: points-bounce 1s infinite alternate; position: relative; margin: 0 auto 16px;">
        ${icon('goPointsLogo', 38)}
      </div>
      <h2 style="font-family: var(--font-display); font-size: 1.45rem; font-weight: 950; margin: 0 0 6px; color: var(--color-text-primary); letter-spacing: -0.02em;">
        ¡Pedido Entregado!
      </h2>
      <p style="font-size: 12.5px; color: var(--color-text-secondary); margin: 0; font-weight: 600;">
        Tu pedido #${(order.orderId || order.id || '').toString().slice(-4).toUpperCase()} llegó con éxito.
      </p>
    </div>

    <!-- Puntos Sumados Card -->
    <div style="background: var(--color-bg-secondary); border: 1.5px solid var(--color-border-light); border-radius: 20px; padding: 14px 20px; display: flex; flex-direction: column; align-items: center; gap: 2px; box-shadow: var(--shadow-sm); margin-bottom: 24px;">
      <span style="font-size: 10px; font-weight: 900; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: 0.8px;">Sumaste en Club GO</span>
      <div style="font-size: 28px; font-weight: 950; color: #f59e0b; letter-spacing: -0.5px; display: flex; align-items: center; gap: 4px;">
        +${points} <span style="font-size: 13px; font-weight: 850; letter-spacing: 0;">GO PTS</span>
      </div>
      <div style="font-size: 11.5px; color: var(--color-text-secondary); font-weight: 700;">
        Equivalentes a <strong style="color: var(--color-success); font-weight: 900;">${formatPrice(valueDiscount)}</strong> de descuento directo.
      </div>
      <div style="font-size: 10.5px; color: var(--color-text-tertiary); font-weight: 600; margin-top: 4px;">
        Multiplicador <strong style="color: ${levelColor}; font-weight: 900;">${levelName}</strong> activo (${order.appliedMultiplier || multiplier}x)
      </div>
    </div>

    ${order.driverId ? `
      <!-- Rating Section (Stable Height Container) -->
      <div style="border-top: 1px solid var(--color-border-light); padding-top: 20px; margin-bottom: 20px;">
        <p style="font-size: 13.5px; font-weight: 800; color: var(--color-text-secondary); margin: 0 0 14px;">
          ¿Cómo fue tu experiencia con <strong style="color: var(--color-text-primary); font-weight: 900;">${order.driverName || 'tu repartidor'}</strong>?
        </p>
        <div class="rating-stars" style="display: flex; justify-content: center; gap: 10px; margin-bottom: 20px;">
          ${[1, 2, 3, 4, 5].map(i => `
            <button class="star-btn" data-value="${i}" style="
              width: 46px; height: 46px; border-radius: 14px; border: 2px solid var(--color-border-light);
              background: var(--color-bg-secondary);
              color: var(--color-text-tertiary);
              display: flex; align-items: center; justify-content: center; cursor: pointer;
              transition: all 0.2s ease;
            ">
              ${icon('star', 20)}
            </button>
          `).join('')}
        </div>
      </div>

      <!-- Comment Section (Always in DOM but textarea expands smoothly when rating selected) -->
      <div id="comment-container" style="text-align: left; margin-bottom: 20px; max-height: 0; opacity: 0; overflow: hidden; transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);">
        <label style="font-size: 12px; font-weight: 700; color: var(--color-text-secondary); display: block; margin-bottom: 6px;">
          Comentario (opcional)
        </label>
        <textarea id="rating-comment" class="input" placeholder="Contanos cómo fue la entrega..." 
          style="min-height: 72px; resize: none; font-size: 14px; border-radius: 16px; width: 100%; border: 1.5px solid var(--color-border-light); padding: 10px 14px; background: var(--color-bg-card); font-family: inherit; font-weight: 600; outline: none; box-sizing: border-box;"></textarea>
      </div>
    ` : ''}

    <div style="display: flex; gap: 10px; margin-top: 8px;">
      <button class="btn btn-ghost" id="rating-skip-btn" style="flex: 1; height: 52px; border-radius: 16px; font-weight: 800; font-size: 13.5px; color: var(--color-text-tertiary); text-transform: uppercase;">
        ${order.driverId ? 'Omitir' : 'Cerrar'}
      </button>
      ${order.driverId ? `
        <button class="btn btn-primary" id="rating-submit-btn" style="flex: 2; height: 52px; border-radius: 16px; font-weight: 900; font-size: 13.5px; opacity: 0.4; pointer-events: none; text-transform: uppercase; letter-spacing: 0.5px; transition: all 0.2s ease;" disabled>
          ${icon('star', 16)} Enviar Puntuación
        </button>
      ` : ''}
    </div>

    <style>
      @keyframes points-bounce {
        0% { transform: translateY(0) scale(1); }
        100% { transform: translateY(-5px) scale(1.02); }
      }
      @keyframes star-pop {
        0% { transform: scale(1); }
        50% { transform: scale(1.22) rotate(10deg); }
        100% { transform: scale(1); }
      }
      .star-btn.active {
        border-color: #f59e0b !important;
        background: rgba(245,158,11,0.12) !important;
        color: #f59e0b !important;
        box-shadow: 0 4px 10px rgba(245,158,11,0.15) !important;
      }
      .star-btn.pop {
        animation: star-pop 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      }
    </style>
  `;

  if (order.driverId) {
    const starBtns = modalContent.querySelectorAll('.star-btn');
    const commentContainer = modalContent.querySelector('#comment-container');
    const submitBtn = modalContent.querySelector('#rating-submit-btn');

    starBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        selectedRating = parseInt(btn.dataset.value);

        // Update star buttons styles in-place without redraw
        starBtns.forEach((sBtn, idx) => {
          const val = idx + 1;
          if (val <= selectedRating) {
            sBtn.classList.add('active');
            if (val === selectedRating) {
              sBtn.classList.remove('pop');
              void sBtn.offsetWidth; // Trigger reflow
              sBtn.classList.add('pop');
            }
          } else {
            sBtn.classList.remove('active');
            sBtn.classList.remove('pop');
          }
        });

        // Expand comment field smoothly
        if (commentContainer) {
          commentContainer.style.maxHeight = '120px';
          commentContainer.style.opacity = '1';
        }

        // Enable submit button
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.style.opacity = '1';
          submitBtn.style.pointerEvents = 'auto';
        }
      });
    });
  }

  // Skip click listener
  modalContent.querySelector('#rating-skip-btn')?.addEventListener('click', () => {
    localStorage.setItem(`gd_dismissed_points_modal_${order.id}`, 'true');
    closeModal();
  });

  // Submit click listener
  modalContent.querySelector('#rating-submit-btn')?.addEventListener('click', async () => {
    if (selectedRating === 0) return;

    const comment = modalContent.querySelector('#rating-comment')?.value?.trim() || '';
    const submitBtn = modalContent.querySelector('#rating-submit-btn');
    const skipBtn = modalContent.querySelector('#rating-skip-btn');
    
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = `${icon('loader', 16, 'animate-spin')} Enviando...`;
    }
    if (skipBtn) skipBtn.disabled = true;

    try {
      if (!order.id || typeof order.id !== 'string') {
        localStorage.setItem(`gd_dismissed_points_modal_${order.id}`, 'true');
        closeModal();
        return;
      }

      const orderRef = doc(db, 'orders', order.id);
      await updateDoc(orderRef, {
        driverRating: selectedRating,
        driverRatingComment: comment,
        driverRatedAt: serverTimestamp()
      });

      if (order.driverId && typeof order.driverId === 'string' && order.driverId.length > 0) {
        const driverRef = doc(db, 'users', order.driverId);
        await updateDoc(driverRef, {
          ratings: arrayUnion({
            orderId: order.id,
            rating: selectedRating,
            comment: comment,
            userId: user.uid,
            userName: user.displayName || user.name || 'Cliente',
            comercioName: order.comercioName || 'Comercio',
            createdAt: new Date().toISOString()
          })
        });
      }

      localStorage.setItem(`gd_dismissed_points_modal_${order.id}`, 'true');
      closeModal();
      showToast('¡Gracias por tu puntuación!', 'success');
    } catch (err) {
      console.error('Error submitting rating:', err);
      
      const isNotFound = err.code === 'not-found' || (err.message && err.message.includes('No document to update'));
      if (isNotFound) {
        localStorage.setItem(`gd_dismissed_points_modal_${order.id}`, 'true');
        closeModal();
        showToast('El pedido ya no existe en el sistema', 'warning');
        return;
      }

      showToast('Error al enviar la puntuación', 'error');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = `${icon('star', 16)} Enviar Puntuación`;
      }
      if (skipBtn) skipBtn.disabled = false;
    }
  });

  showModal({
    title: '',
    content: modalContent,
    hideHeader: true,
    persistent: true,
    height: 'auto'
  });
}
