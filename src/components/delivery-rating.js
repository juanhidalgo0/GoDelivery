// GoDelivery — Delivery Rating Component
import { db } from '../firebase.js';
import { doc, updateDoc, arrayUnion, serverTimestamp } from 'firebase/firestore';
import { getState } from '../state.js';
import { showModal, closeModal } from './modal.js';
import { icon } from '../utils/icons.js';
import { showToast } from './toast.js';

/**
 * Show a rating modal for a delivered order
 * @param {Object} order - The completed order object
 */
export function showDeliveryRating(order) {
  if (!order || !order.driverId || order.driverRating) return;

  const user = getState().user;
  if (!user || user.uid !== order.userId) return;

  let selectedRating = 0;

  const modalContent = document.createElement('div');
  modalContent.style.cssText = 'padding: 32px 24px 24px; text-align: center;';

  function render() {
    modalContent.innerHTML = `
      <div style="margin-bottom: 28px;">
        <div style="width: 72px; height: 72px; background: linear-gradient(135deg, rgba(245,158,11,0.15), rgba(245,158,11,0.05)); color: #f59e0b; border-radius: 22px; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px; box-shadow: 0 8px 25px rgba(245,158,11,0.12);">
          ${icon('star', 36)}
        </div>
        <h2 style="font-family: var(--font-display); font-size: 1.4rem; font-weight: 900; margin: 0 0 8px; color: var(--color-text); letter-spacing: -0.02em;">
          ¿Cómo fue tu experiencia?
        </h2>
        <p style="font-size: 14px; color: var(--color-text-tertiary); margin: 0; line-height: 1.5;">
          Puntuá a <strong style="color: var(--color-text);">${order.driverName || 'tu repartidor'}</strong>
        </p>
      </div>

      <div class="rating-stars" style="display: flex; justify-content: center; gap: 12px; margin-bottom: 28px;">
        ${[1, 2, 3, 4, 5].map(i => `
          <button class="star-btn" data-value="${i}" style="
            width: 52px; height: 52px; border-radius: 16px; border: 2px solid ${i <= selectedRating ? '#f59e0b' : 'var(--color-border-light)'};
            background: ${i <= selectedRating ? 'rgba(245,158,11,0.12)' : 'var(--color-bg-secondary)'};
            color: ${i <= selectedRating ? '#f59e0b' : 'var(--color-text-tertiary)'};
            display: flex; align-items: center; justify-content: center; cursor: pointer;
            transition: all 0.2s; transform: ${i <= selectedRating ? 'scale(1.1)' : 'scale(1)'};
            box-shadow: ${i <= selectedRating ? '0 4px 12px rgba(245,158,11,0.2)' : 'none'};
          ">
            ${icon('star', 24)}
          </button>
        `).join('')}
      </div>

      ${selectedRating > 0 ? `
        <div style="text-align: left; margin-bottom: 20px;">
          <label style="font-size: 12px; font-weight: 700; color: var(--color-text-secondary); display: block; margin-bottom: 6px;">
            Comentario (opcional)
          </label>
          <textarea id="rating-comment" class="input" placeholder="Contanos cómo fue la entrega..." 
            style="min-height: 80px; resize: none; font-size: 14px; border-radius: 16px;">${modalContent.querySelector('#rating-comment')?.value || ''}</textarea>
          <p style="font-size: 10px; color: var(--color-text-tertiary); margin-top: 4px;">
            Tu comentario será visible únicamente para los administradores de la plataforma.
          </p>
        </div>
      ` : ''}

      <div style="display: flex; gap: 10px; margin-top: 8px;">
        <button class="btn btn-ghost" id="rating-skip-btn" style="flex: 1; height: 52px; border-radius: 16px; font-weight: 600; color: var(--color-text-tertiary);">
          Omitir
        </button>
        <button class="btn btn-primary" id="rating-submit-btn" style="flex: 2; height: 52px; border-radius: 16px; font-weight: 800; font-size: 1rem; opacity: ${selectedRating > 0 ? '1' : '0.4'}; pointer-events: ${selectedRating > 0 ? 'auto' : 'none'};"
        >
          ${icon('star', 18)} Enviar Puntuación
        </button>
      </div>
    `;

    // Star click handlers
    modalContent.querySelectorAll('.star-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedRating = parseInt(btn.dataset.value);
        render();
      });
    });

    // Skip
    modalContent.querySelector('#rating-skip-btn')?.addEventListener('click', () => {
      closeModal();
    });

    // Submit
    modalContent.querySelector('#rating-submit-btn')?.addEventListener('click', async () => {
      if (selectedRating === 0) return;

      const comment = modalContent.querySelector('#rating-comment')?.value?.trim() || '';
      const submitBtn = modalContent.querySelector('#rating-submit-btn');
      submitBtn.disabled = true;
      submitBtn.innerHTML = `${icon('loader', 18, 'animate-spin')} Enviando...`;

      try {
        // Validate all references before calling Firestore
        if (!order.id || typeof order.id !== 'string') {
          console.warn('Rating skipped: invalid order.id', order.id);
          closeModal();
          return;
        }
        if (!db) {
          console.warn('Rating skipped: db is not initialized');
          closeModal();
          return;
        }

        const orderRef = doc(db, 'orders', order.id);
        await updateDoc(orderRef, {
          driverRating: selectedRating,
          driverRatingComment: comment,
          driverRatedAt: serverTimestamp()
        });

        // Also update driver's ratings collection for averages
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
        } else {
          console.warn('Rating: skipped driver update, driverId =', order.driverId);
        }

        closeModal();
        showToast('¡Gracias por tu puntuación!', 'success');
      } catch (err) {
        console.error('Error submitting rating:', err);
        showToast('Error al enviar la puntuación', 'error');
        submitBtn.disabled = false;
        submitBtn.innerHTML = `${icon('star', 18)} Enviar Puntuación`;
      }
    });
  }

  render();

  showModal({
    title: '',
    content: modalContent,
    hideHeader: true
  });
}
