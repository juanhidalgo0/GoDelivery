// GoDelivery — Modal Component with Ultra-Fluid Stacking & Swipe
import { icon } from '../utils/icons.js';

let modalStack = [];

export function showModal({ title, content, footer, onOpen, onClose, hideHeader = false, fullSwipe = false, height = '88dvh', fullscreen = false, persistent = false, headerBackground = '', headerTextColor = '' }) {
  const container = document.getElementById('modal-container');
  if (!container) return;

  const modalId = `modal-${Math.random().toString(36).substr(2, 9)}`;
  const modalWrapper = document.createElement('div');
  modalWrapper.id = modalId;
  modalWrapper.className = 'modal-stack-wrapper';
  
  const zIndex = 2000 + (modalStack.length * 10);
  modalWrapper.style.cssText = `position:fixed; inset:0; z-index:${zIndex};`;

  const isFullscreen = fullscreen === true;
  const finalHeight = isFullscreen ? '100%' : height;

  modalWrapper.innerHTML = `
    <div class="modal-overlay" id="${modalId}-overlay" style="
      position:fixed; inset:0; background:rgba(0,0,0,${isFullscreen ? '1' : '0.35'}); backdrop-filter:${isFullscreen ? 'none' : 'blur(4px)'}; -webkit-backdrop-filter:${isFullscreen ? 'none' : 'blur(4px)'};
      animation: fadeIn 0.25s ease-out;
      will-change: background;
    ">
      <div class="modal" id="${modalId}-dialog" style="
        background:var(--color-bg); border-radius:${isFullscreen ? '0' : '28px 28px 0 0'}; width:100%; max-width:${isFullscreen ? 'none' : '500px'}; max-height:${isFullscreen ? 'none' : '94dvh'};
        height:${finalHeight}; margin:0 auto; overflow:hidden; position:relative; display:flex; flex-direction:column;
        animation: ${isFullscreen ? 'fadeIn' : 'springUp'} 0.28s cubic-bezier(0.25, 0.8, 0.25, 1);
        box-shadow: ${isFullscreen ? 'none' : '0 -12px 60px rgba(0,0,0,0.35)'};
        margin-top: ${isFullscreen ? '0' : (finalHeight === 'auto' ? 'auto' : `calc(100dvh - ${finalHeight})`)};
        will-change: transform, opacity;
      ">
        ${!isFullscreen ? `<div class="modal-handle" id="${modalId}-handle" style="width:44px; height:5px; background:rgba(120,120,120,0.4); border-radius:var(--radius-full); position:absolute; top:12px; left:50%; transform:translateX(-50%); z-index:200; cursor:grab;"></div>` : ''}
        ${!hideHeader && !isFullscreen ? `
          <div class="modal-header" id="${modalId}-header-drag" style="display:flex; align-items:center; justify-content:space-between; padding:20px 24px; border-bottom:1.5px solid rgba(0,0,0,0.06); z-index:90; ${headerBackground ? `background:${headerBackground};` : 'background:var(--color-bg-secondary);'}">
            <h3 style="font-family:var(--font-display); font-size:1.2rem; font-weight:900; margin:0; letter-spacing:-0.01em; ${headerTextColor ? `color:${headerTextColor};` : 'color:var(--color-text-primary);'}">${title}</h3>
            <button class="modal-close" id="${modalId}-close-btn" style="width:40px; height:40px; border:none; background:transparent; cursor:pointer; display:flex; align-items:center; justify-content:center; border-radius:50%; transition:background 0.2s; ${headerTextColor ? `color:${headerTextColor};` : 'color:var(--color-text-secondary);'}">${icon('close', 22)}</button>
          </div>
        ` : ''}
        <div class="modal-body" id="${modalId}-body" style="flex:1; overflow:hidden; position:relative; display:flex; flex-direction:column; ${hideHeader || isFullscreen ? 'padding:0;' : ''}">
          ${typeof content === 'string' ? content : ''}
        </div>
        ${footer && !isFullscreen ? `<div class="modal-footer" style="padding:20px 24px calc(20px + env(safe-area-inset-bottom, 0px)) 24px; border-top:1px solid var(--color-border-light); background:var(--color-bg);">${footer}</div>` : ''}
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

    // Ultra-fluid spring down animation
    dialog.style.transition = 'transform 0.24s cubic-bezier(0.25, 0.8, 0.25, 1), opacity 0.2s ease-out';
    dialog.style.transform = 'translateY(100%) scale(0.95)';
    
    overlay.style.transition = 'opacity 0.2s ease-out';
    overlay.style.opacity = '0';
    
    setTimeout(() => {
      modalWrapper.remove();
      
      if (modalStack.length <= 1) {
        document.body.classList.remove('multiple-modals');
      }
      // Restore pull-to-refresh when all modals are closed
      if (modalStack.length === 0) {
        document.body.style.overscrollBehaviorY = 'auto';
        document.documentElement.style.overscrollBehaviorY = 'auto';
        document.body.classList.remove('modal-open');
      }
      
      if (onClose) onClose();
    }, 240);
  };

  const modalObj = { id: modalId, wrapper: modalWrapper, onClose, close };
  modalStack.push(modalObj);

  // Prevent pull-to-refresh when modals are open
  if (modalStack.length === 1) {
    document.body.style.overscrollBehaviorY = 'contain';
    document.documentElement.style.overscrollBehaviorY = 'contain';
    document.body.classList.add('modal-open');
  } else if (modalStack.length > 1) {
    document.body.classList.add('multiple-modals');
  }

  if (onOpen) requestAnimationFrame(() => onOpen());

  // Swipe logic
  let startY = 0;
  let currentY = 0;
  let isDragging = false;
  let startTime = 0;

  const onTouchStart = (e) => {
    if (['INPUT', 'BUTTON', 'A', 'TEXTAREA'].includes(e.target.tagName)) return;
    
    // Disable card dragging when touching inside scrollable containers (like the flavors list)
    const scrollableArea = e.target.closest('.pm-content, .scrollable, [style*="overflow-y: auto"], [style*="overflow-y:auto"]');
    if (scrollableArea) {
      if (!e.target.closest('.modal-handle, #modal-handle, [id*="-handle"], [id*="-header-drag"]')) {
        return;
      }
    }
    
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
    overlay.style.background = `rgba(0,0,0,${0.35 * (1 - progress * 0.5)})`;
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
      overlay.style.background = 'rgba(0,0,0,0.35)';
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

  if (modalStack.length <= 1) {
    document.body.classList.remove('multiple-modals');
  }
  if (modalStack.length === 0) {
    document.body.style.overscrollBehaviorY = 'auto';
    document.documentElement.style.overscrollBehaviorY = 'auto';
    document.body.classList.remove('modal-open');
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

export function showAlert({ title, message, btnText = 'OK', onClose }) {
  const uid = Math.random().toString(36).substr(2, 5);
  const okId = `modal-ok-${uid}`;

  showModal({
    title,
    height: 'auto',
    content: `<p style="color:var(--color-text-secondary); font-size:15px; line-height:1.6; padding:32px 24px; text-align:center; font-weight:500;">${message}</p>`,
    footer: `
      <div style="display:flex;justify-content:center;width:100%;padding:0 4px 12px 4px;">
        <button class="btn btn-primary" id="${okId}" style="width:100%;height:54px;border-radius:18px;font-weight:900;font-size:14px;padding:0 16px;box-shadow:0 8px 20px rgba(var(--color-primary-rgb),0.25);border:none;background:var(--color-primary);color:white;">${btnText}</button>
      </div>
    `,
    onClose
  });

  const okBtn = document.getElementById(okId);
  if (okBtn) okBtn.addEventListener('click', () => closeModal());
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

// Global Lightbox Implementation with Download Button
window.openLightbox = (url) => {
  if (!url || url === 'undefined') return;

  const imgContainer = document.createElement('div');
  imgContainer.style.width = '100%';
  imgContainer.style.height = '100%';
  imgContainer.style.display = 'flex';
  imgContainer.style.flexDirection = 'column';
  imgContainer.style.alignItems = 'center';
  imgContainer.style.justifyContent = 'center';
  imgContainer.style.background = 'rgba(0, 0, 0, 0.95)';
  imgContainer.style.position = 'relative';

  const img = document.createElement('img');
  img.src = url;
  img.style.maxWidth = '100%';
  img.style.maxHeight = '80dvh';
  img.style.objectFit = 'contain';
  img.style.animation = 'fadeIn 0.3s ease-out';

  // Header/ActionBar on top of Lightbox
  const actionBar = document.createElement('div');
  actionBar.style.position = 'absolute';
  actionBar.style.top = 'max(20px, env(safe-area-inset-top, 20px))';
  actionBar.style.right = '20px';
  actionBar.style.display = 'flex';
  actionBar.style.gap = '14px';
  actionBar.style.zIndex = '2100';

  // Download button
  const downloadBtn = document.createElement('button');
  downloadBtn.innerHTML = icon('download', 24) || '📥';
  downloadBtn.title = 'Descargar imagen';
  downloadBtn.style.background = 'rgba(255,255,255,0.15)';
  downloadBtn.style.color = 'white';
  downloadBtn.style.border = 'none';
  downloadBtn.style.borderRadius = '50%';
  downloadBtn.style.width = '44px';
  downloadBtn.style.height = '44px';
  downloadBtn.style.display = 'flex';
  downloadBtn.style.alignItems = 'center';
  downloadBtn.style.justifyContent = 'center';
  downloadBtn.style.cursor = 'pointer';
  downloadBtn.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
  downloadBtn.style.backdropFilter = 'blur(5px)';

  downloadBtn.onclick = async (e) => {
    e.stopPropagation();
    try {
      downloadBtn.disabled = true;
      downloadBtn.innerHTML = icon('loader', 20, 'animate-spin') || '...';
      
      const res = await fetch(url);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `GoDelivery_Image_${Date.now()}.jpg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
      
      import('./toast.js').then(m => m.showToast('Imagen descargada', 'success'));
    } catch (err) {
      console.error('Error downloading image:', err);
      import('./toast.js').then(m => m.showToast('Error al descargar imagen', 'error'));
    } finally {
      downloadBtn.disabled = false;
      downloadBtn.innerHTML = icon('download', 24) || '📥';
    }
  };

  // Close button
  const closeBtn = document.createElement('button');
  closeBtn.innerHTML = icon('close', 24) || '✕';
  closeBtn.title = 'Cerrar';
  closeBtn.style.background = 'rgba(255,255,255,0.15)';
  closeBtn.style.color = 'white';
  closeBtn.style.border = 'none';
  closeBtn.style.borderRadius = '50%';
  closeBtn.style.width = '44px';
  closeBtn.style.height = '44px';
  closeBtn.style.display = 'flex';
  closeBtn.style.alignItems = 'center';
  closeBtn.style.justifyContent = 'center';
  closeBtn.style.cursor = 'pointer';
  closeBtn.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
  closeBtn.style.backdropFilter = 'blur(5px)';

  closeBtn.onclick = () => closeModal();

  actionBar.appendChild(downloadBtn);
  actionBar.appendChild(closeBtn);

  imgContainer.appendChild(img);
  imgContainer.appendChild(actionBar);

  imgContainer.onclick = (e) => {
    if (e.target === imgContainer || e.target === img) closeModal();
  };

  showModal({
    title: '',
    content: imgContainer,
    fullscreen: true,
    hideHeader: true
  });
};
