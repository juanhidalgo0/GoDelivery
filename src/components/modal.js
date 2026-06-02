// GoDelivery — Modal Component with Ultra-Fluid Stacking & Swipe
import { icon } from '../utils/icons.js';

let modalStack = [];

export function showModal({ title, content, footer, onOpen, onClose, hideHeader = false, fullSwipe = false, height = '88dvh', fullscreen = false, persistent = false }) {
  const container = document.getElementById('modal-container');
  if (!container) return;

  const modalId = `modal-${Math.random().toString(36).substr(2, 9)}`;
  const modalWrapper = document.createElement('div');
  modalWrapper.id = modalId;
  modalWrapper.className = 'modal-stack-wrapper';
  
  const zIndex = 2000 + (modalStack.length * 10);
  modalWrapper.style.cssText = `position:fixed; inset:0; z-index:${zIndex};`;

  const isFullscreen = fullscreen === true;
  const finalHeight = isFullscreen ? '100dvh' : height;

  modalWrapper.innerHTML = `
    <div class="modal-overlay" id="${modalId}-overlay" style="
      position:fixed; inset:0; background:rgba(0,0,0,${isFullscreen ? '1' : '0.65'}); backdrop-filter:${isFullscreen ? 'none' : 'blur(10px)'}; -webkit-backdrop-filter:${isFullscreen ? 'none' : 'blur(10px)'};
      animation: fadeIn 0.25s ease-out;
      will-change: background;
    ">
      <div class="modal" id="${modalId}-dialog" style="
        background:var(--color-bg); border-radius:${isFullscreen ? '0' : '28px 28px 0 0'}; width:100%; max-width:${isFullscreen ? 'none' : '500px'};
        height:${finalHeight}; margin:0 auto; overflow:hidden; position:relative; display:flex; flex-direction:column;
        animation: ${isFullscreen ? 'fadeIn' : 'slideUp'} 0.4s cubic-bezier(0.16, 1, 0.3, 1);
        box-shadow: ${isFullscreen ? 'none' : '0 -12px 60px rgba(0,0,0,0.35)'};
        margin-top: calc(100dvh - ${finalHeight});
        will-change: transform, opacity;
      ">
        ${!isFullscreen ? `<div class="modal-handle" id="${modalId}-handle" style="width:44px; height:5px; background:rgba(120,120,120,0.4); border-radius:var(--radius-full); position:absolute; top:12px; left:50%; transform:translateX(-50%); z-index:200; cursor:grab;"></div>` : ''}
        ${!hideHeader && !isFullscreen ? `
          <div class="modal-header" id="${modalId}-header-drag" style="display:flex; align-items:center; justify-content:space-between; padding:18px 24px; border-bottom:1px solid var(--color-border-light); z-index:90;">
            <h3 style="font-family:var(--font-display); font-size:1.2rem; font-weight:900; margin:0; letter-spacing:-0.01em;">${title}</h3>
            <button class="modal-close" id="${modalId}-close-btn" style="width:40px; height:40px; border:none; background:transparent; color:var(--color-text-secondary); cursor:pointer; display:flex; align-items:center; justify-content:center; border-radius:50%; transition:background 0.2s;">${icon('close', 22)}</button>
          </div>
        ` : ''}
        <div class="modal-body" id="${modalId}-body" style="flex:1; overflow:hidden; position:relative; display:flex; flex-direction:column; ${hideHeader || isFullscreen ? 'padding:0;' : ''}">
          ${typeof content === 'string' ? content : ''}
        </div>
        ${footer && !isFullscreen ? `<div class="modal-footer" style="padding:20px 24px; border-top:1px solid var(--color-border-light); background:var(--color-bg);">${footer}</div>` : ''}
      </div>
    </div>
  `;

  container.appendChild(modalWrapper);
  const body = document.getElementById(`${modalId}-body`);
  if (typeof content !== 'string' && content) body.appendChild(content);

  // Push history state to support Android physical back button
  window.history.pushState({ isModalId: modalId }, '');

  const dialog = document.getElementById(`${modalId}-dialog`);
  const overlay = document.getElementById(`${modalId}-overlay`);
  
  const close = (isPopState = false) => {
    // Prevent multiple closing triggers
    const inStack = modalStack.some(m => m.id === modalId);
    if (!inStack) return;

    modalStack = modalStack.filter(m => m.id !== modalId);
    
    // Pop history state if not triggered by native popstate (back button)
    if (!isPopState && window.history.state && window.history.state.isModalId === modalId) {
      window.history.back();
    }

    // Ultra-fluid slide down animation
    dialog.style.transition = 'transform 0.45s cubic-bezier(0.32, 0, 0.67, 0)';
    dialog.style.transform = 'translateY(100%)';
    
    overlay.style.transition = 'opacity 0.35s ease-out';
    overlay.style.opacity = '0';
    
    setTimeout(() => {
      modalWrapper.remove();
      
      // Restore pull-to-refresh when all modals are closed
      if (modalStack.length === 0) {
        document.body.style.overscrollBehaviorY = 'auto';
        document.documentElement.style.overscrollBehaviorY = 'auto';
      }
      
      if (onClose) onClose();
    }, 450);
  };

  const modalObj = { id: modalId, wrapper: modalWrapper, onClose, close };
  modalStack.push(modalObj);

  // Prevent pull-to-refresh when modals are open
  if (modalStack.length === 1) {
    document.body.style.overscrollBehaviorY = 'contain';
    document.documentElement.style.overscrollBehaviorY = 'contain';
  }

  if (onOpen) requestAnimationFrame(() => onOpen());

  // Swipe logic
  let startY = 0;
  let currentY = 0;
  let isDragging = false;
  let startTime = 0;

  const onTouchStart = (e) => {
    if (['INPUT', 'BUTTON', 'A', 'TEXTAREA'].includes(e.target.tagName)) return;
    
    startY = e.touches[0].clientY;
    startTime = Date.now();
    isDragging = true;
    dialog.style.transition = 'none';
    overlay.style.transition = 'none';
  };

  const onTouchMove = (e) => {
    if (!isDragging) return;
    currentY = e.touches[0].clientY;
    const diff = currentY - startY;
    
    // Fluid downward translation with resistance on upward pull
    const translateY = diff > 0 ? diff : diff * 0.15;
    dialog.style.transform = `translateY(${translateY}px)`;
    
    // Dynamic overlay fade
    const progress = Math.min(Math.max(0, diff) / 450, 1);
    overlay.style.opacity = 1 - (progress * 0.8);
    overlay.style.background = `rgba(0,0,0,${0.65 * (1 - progress * 0.5)})`;
  };

  const onTouchEnd = () => {
    if (!isDragging) return;
    isDragging = false;
    const diff = currentY - startY;
    const duration = Date.now() - startTime;
    const velocity = diff / duration;

    // Standard fluid transition back or away
    dialog.style.transition = 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)';
    overlay.style.transition = 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)';

    if (diff > 180 || (velocity > 0.6 && diff > 50)) {
      close();
    } else {
      dialog.style.transform = 'translateY(0)';
      overlay.style.opacity = '1';
      overlay.style.background = 'rgba(0,0,0,0.65)';
    }
  };

  // Attach swipe logic to drag areas
  const handle = document.getElementById(`${modalId}-handle`);
  const headerDrag = document.getElementById(`${modalId}-header-drag`);
  
  const addListeners = (el) => {
    if (!el) return;
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: true });
    el.addEventListener('touchend', onTouchEnd);
  };

  if (!persistent) {
    addListeners(handle);
    addListeners(headerDrag);

    if (fullSwipe) {
      addListeners(dialog);
    } else {
      // Top-portion fallback (increased to 140px for easier catch)
      dialog.addEventListener('touchstart', (e) => {
        const rect = dialog.getBoundingClientRect();
        const relativeY = e.touches[0].clientY - rect.top;
        if (relativeY < 140) onTouchStart(e);
      }, { passive: true });
      dialog.addEventListener('touchmove', onTouchMove, { passive: true });
      dialog.addEventListener('touchend', onTouchEnd);
    }

    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  }
  const closeBtn = document.getElementById(`${modalId}-close-btn`);
  if (closeBtn) closeBtn.addEventListener('click', close);

  return { close };
}

export function closeMultipleModals(count = 1, isPopState = false) {
  if (count <= 0) return;
  const modalsToClose = [];
  for (let i = 0; i < count; i++) {
    const modal = modalStack.pop();
    if (modal) {
      modalsToClose.push(modal);
    }
  }

  if (modalsToClose.length === 0) return;

  modalsToClose.forEach(modal => {
    const dialog = document.getElementById(`${modal.id}-dialog`);
    const overlay = document.getElementById(`${modal.id}-overlay`);
    const modalWrapper = modal.wrapper;

    if (dialog) {
      dialog.style.transition = 'transform 0.45s cubic-bezier(0.32, 0, 0.67, 0)';
      dialog.style.transform = 'translateY(100%)';
    }
    if (overlay) {
      overlay.style.transition = 'opacity 0.35s ease-out';
      overlay.style.opacity = '0';
    }

    setTimeout(() => {
      modalWrapper.remove();
      if (modal.onClose) {
        try { modal.onClose(); } catch (e) { console.error(e); }
      }
    }, 450);
  });

  if (modalStack.length === 0) {
    document.body.style.overscrollBehaviorY = 'auto';
    document.documentElement.style.overscrollBehaviorY = 'auto';
  }

  if (!isPopState) {
    window.history.go(-modalsToClose.length);
  }
}

export function closeModal(isPopState = false) {
  closeMultipleModals(1, isPopState);
}

export function closeAllModals(isPopState = false) {
  closeMultipleModals(modalStack.length, isPopState);
}

export function showConfirm({ title, message, confirmText = 'Confirmar', cancelText = 'Cancelar', onConfirm, onCancel, danger = false }) {
  const uid = Math.random().toString(36).substr(2, 5);
  const cancelId = `modal-cancel-${uid}`;
  const confirmId = `modal-confirm-${uid}`;
  
  let hasConfirmed = false;

  showModal({
    title,
    height: 'auto',
    content: `<p style="color:var(--color-text-secondary); font-size:15px; line-height:1.6; padding:32px 24px; text-align:center; font-weight:500;">${message}</p>`,
    footer: `
      <div style="display:flex;flex-wrap:wrap;gap:12px;width:100%;padding:0 4px 12px 4px;">
        <button class="btn btn-ghost" id="${cancelId}" style="flex:1;min-width:120px;height:54px;border-radius:18px;font-weight:800;font-size:14px;color:var(--color-text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:0 12px;background:var(--color-bg-secondary);border:1px solid var(--color-border);">${cancelText}</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="${confirmId}" style="flex:1.5;min-width:160px;height:54px;border-radius:18px;font-weight:900;font-size:14px;padding:0 16px;${danger ? 'background:linear-gradient(135deg,#EF4444,#DC2626);color:white;box-shadow:0 8px 20px rgba(239,68,68,0.35);border:none;' : 'box-shadow:0 8px 20px rgba(var(--color-primary-rgb),0.25);'}">${confirmText}</button>
      </div>
    `,
    onClose: () => {
      if (!hasConfirmed && onCancel) {
        onCancel();
      }
    }
  });

  const cancelBtn = document.getElementById(cancelId);
  const confirmBtn = document.getElementById(confirmId);
  if (cancelBtn) cancelBtn.addEventListener('click', closeModal);
  if (confirmBtn) {
    confirmBtn.addEventListener('click', async () => {
      if (onConfirm) {
        confirmBtn.disabled = true;
        if (cancelBtn) cancelBtn.disabled = true;
        
        const originalHTML = confirmBtn.innerHTML;
        confirmBtn.innerHTML = `<span class="animate-spin" style="display:inline-block; margin-right:8px;">${icon('loader', 14)}</span> PROCESANDO...`;
        
        try {
          await onConfirm();
          hasConfirmed = true;
          closeModal();
        } catch (err) {
          console.error('Action confirmation failed:', err);
          confirmBtn.disabled = false;
          if (cancelBtn) cancelBtn.disabled = false;
          confirmBtn.innerHTML = originalHTML;
        }
      } else {
        closeModal();
      }
    });
  }
}

// Android physical Back Button / browser back interceptor to support closing stacked modals in order.
window.addEventListener('popstate', (e) => {
  const activeModalId = e.state ? e.state.isModalId : null;
  
  if (!activeModalId) {
    closeAllModals(true);
    return;
  }
  
  const idx = modalStack.findIndex(m => m.id === activeModalId);
  if (idx !== -1) {
    closeMultipleModals(modalStack.length - (idx + 1), true);
  }
});
