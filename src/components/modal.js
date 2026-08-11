// GoDelivery — Modal Component with Ultra-Fluid Stacking & Swipe
import { icon } from '../utils/icons.js';

let modalStack = [];

export function showModal({ title, content, footer, onOpen, onClose, hideHeader = false, fullSwipe = false, height = '88vh', fullscreen = false, persistent = false, headerBackground = '', headerTextColor = '', slideFromRight = false }) {
  const container = document.getElementById('modal-container');
  if (!container) return;

  const modalId = `modal-${Math.random().toString(36).substr(2, 9)}`;
  const modalWrapper = document.createElement('div');
  modalWrapper.id = modalId;
  modalWrapper.className = 'modal-stack-wrapper';
  
  const zIndex = 20000000 + (modalStack.length * 10);
  modalWrapper.style.cssText = `position:fixed; top:0; left:0; width:100%; height:100lvh; z-index:${zIndex};`;

  if (!window._maxInnerHeight || window.innerHeight > window._maxInnerHeight) {
    window._maxInnerHeight = window.innerHeight;
  }
  const baseHeight = window._maxInnerHeight;

  // Inject slide keyframes if they don't exist
  if (!document.getElementById('modal-slide-keyframes')) {
    const styleEl = document.createElement('style');
    styleEl.id = 'modal-slide-keyframes';
    styleEl.textContent = `
      @keyframes slideInRight {
        from { transform: translateX(100%); }
        to { transform: translateX(0); }
      }
      @keyframes slideOutRight {
        from { transform: translateX(0); }
        to { transform: translateX(100%); }
      }
    `;
    document.head.appendChild(styleEl);
  }

  const isFullscreen = fullscreen === true;
  let finalHeight = isFullscreen ? '100%' : height;
  let marginTopStyle = 'margin-top: 0;';
  let maxHStyle = 'max-height: 94vh !important;';
  let borderRadiusStyle = isFullscreen ? '0' : '28px 28px 0 0';
  let modalAnimation = isFullscreen ? 'fadeIn' : 'springUp';
  let modalMargin = 'margin:0 auto;';

  if (slideFromRight) {
    finalHeight = '100%';
    marginTopStyle = 'margin-top: 0;';
    maxHStyle = 'max-height: none !important;';
    borderRadiusStyle = '0';
    modalAnimation = 'slideInRight';
    modalMargin = 'margin: 0 0 0 auto;';
  } else if (!isFullscreen) {
    if (height.endsWith('vh') || height.endsWith('dvh')) {
      const pct = parseFloat(height) / 100;
      const pxHeight = Math.round(baseHeight * pct);
      finalHeight = `${pxHeight}px`;
      marginTopStyle = `margin-top: ${baseHeight - pxHeight}px;`;
      maxHStyle = `max-height: ${Math.round(baseHeight * 0.94)}px !important;`;
    } else if (height === 'auto') {
      marginTopStyle = 'margin-top: auto;';
    } else {
      marginTopStyle = `margin-top: calc(100vh - ${height});`;
    }
  }

  modalWrapper.innerHTML = `
    <div class="modal-overlay" id="${modalId}-overlay" style="
      position:fixed; top:0; left:0; width:100%; height:100lvh; background:rgba(0,0,0,${slideFromRight ? '0.15' : (isFullscreen ? '1' : '0.45')});
      display:flex !important; align-items:${slideFromRight ? 'stretch' : (isFullscreen ? 'stretch' : 'flex-start')} !important; justify-content:${slideFromRight ? 'flex-end' : 'center'} !important;
      animation: fadeIn 0.25s ease-out !important;
      will-change: background;
    ">
      <div class="modal" id="${modalId}-dialog" style="
        background:transparent !important; border-radius:${borderRadiusStyle} !important; width:100% !important; max-width:${isFullscreen ? 'none' : '500px'} !important; max-height:${isFullscreen ? 'none' : maxHStyle} !important;
        height:${finalHeight} !important; ${modalMargin.replace(';', ' !important;')} overflow:hidden !important; position:relative !important; display:flex !important; flex-direction:column !important;
        animation: ${modalAnimation} 0.35s cubic-bezier(0.16, 1, 0.3, 1) both !important;
        box-shadow: ${isFullscreen ? 'none' : '0 -12px 60px rgba(0,0,0,0.35)'} !important;
        ${marginTopStyle.replace(';', ' !important;')}
        will-change: transform, opacity;
        transform: translateZ(0);
      ">
        ${!isFullscreen ? `<div class="modal-handle" id="${modalId}-handle" style="width:44px; height:5px; background:rgba(255,255,255,0.55); border-radius:var(--radius-full); position:absolute; top:6px; left:50%; transform:translateX(-50%); z-index:200; cursor:grab; box-shadow: 0 1px 2px rgba(0,0,0,0.15);"></div>` : ''}
        ${!hideHeader && !isFullscreen ? `
          <div class="modal-header" id="${modalId}-header-drag" style="display:flex; align-items:center; justify-content:space-between; padding:20px 24px; border-bottom:1.5px solid rgba(0,0,0,0.06); z-index:90; flex-shrink:0; ${headerBackground ? `background:${headerBackground};` : 'background:var(--color-bg-secondary);'}">
            <h3 style="font-family:var(--font-display); font-size:1.2rem; font-weight:900; margin:0; letter-spacing:-0.01em; ${headerTextColor ? `color:${headerTextColor};` : 'color:var(--color-text-primary);'}">${title}</h3>
            <button class="modal-close" id="${modalId}-close-btn" style="width:40px; height:40px; border:none; background:transparent; cursor:pointer; display:flex; align-items:center; justify-content:center; border-radius:50%; transition:background 0.2s; ${headerTextColor ? `color:${headerTextColor};` : 'color:var(--color-text-secondary);'}">${icon('close', 22)}</button>
          </div>
        ` : ''}
        <div class="modal-body" id="${modalId}-body" style="flex:1 !important; min-height:0 !important; overflow-y:auto !important; -webkit-overflow-scrolling:touch !important; position:relative !important; display:flex !important; flex-direction:column !important; background:var(--color-bg) !important; ${hideHeader || isFullscreen ? 'padding:0 !important;' : ''}">
          ${typeof content === 'string' ? content : ''}
        </div>
        ${footer && !isFullscreen ? `<div class="modal-footer" style="padding:20px 24px calc(20px + env(safe-area-inset-bottom, 0px)) 24px; border-top:1px solid var(--color-border-light); background:var(--color-bg); flex-shrink:0;">${footer}</div>` : ''}
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

    dialog.style.animation = 'none';
    dialog.offsetHeight; // Force reflow
    dialog.style.transition = 'transform 0.24s cubic-bezier(0.16, 1, 0.3, 1)';
    dialog.style.transform = slideFromRight ? 'translateX(100%)' : 'translateY(100%)';
    
    overlay.style.transition = 'background-color 0.24s ease-out, opacity 0.24s ease-out';
    overlay.style.backgroundColor = 'rgba(0, 0, 0, 0)';
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

  const modalObj = { id: modalId, wrapper: modalWrapper, onClose, close, slideFromRight };
  modalStack.push(modalObj);

  // Removed visualViewport resize listener to prevent keyboard-driven dialog resizing, layout shifts and parpadeos.

  // Auto scroll focused input into view inside modal
  body.addEventListener('focusin', (e) => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) {
      setTimeout(() => {
        e.target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }, 250);
    }
  });

  body.addEventListener('focusout', (e) => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    }
  });

  if (onOpen) requestAnimationFrame(() => onOpen());

  // Swipe logic
  let startY = 0;
  let currentY = 0;
  let startX = 0;
  let currentX = 0;
  let isDragging = false;
  let startTime = 0;

  const onTouchStart = (e) => {
    if (['INPUT', 'BUTTON', 'A', 'TEXTAREA'].includes(e.target.tagName)) return;
    
    // Disable card dragging when touching inside scrollable containers (like the flavors list)
    const scrollableArea = e.target.closest('.pm-content, .pm-scrollable-body, .pm-options-list, .scrollable, [style*="overflow-y: auto"], [style*="overflow-y:auto"]');
    if (scrollableArea) {
      if (!e.target.closest('.modal-handle, #modal-handle, [id*="-handle"], [id*="-header-drag"]')) {
        return;
      }
    }
    
    if (slideFromRight) {
      startX = e.touches[0].clientX;
    } else {
      startY = e.touches[0].clientY;
    }
    startTime = Date.now();
    isDragging = true;
    dialog.style.animation = 'none';
    dialog.style.transition = 'none';
    overlay.style.transition = 'none';
  };

  const onTouchMove = (e) => {
    if (!isDragging) return;
    let diff = 0;
    if (slideFromRight) {
      currentX = e.touches[0].clientX;
      diff = currentX - startX;
      const translateX = diff > 0 ? diff : diff * 0.15;
      dialog.style.transform = `translateX(${translateX}px)`;
    } else {
      currentY = e.touches[0].clientY;
      diff = currentY - startY;
      const translateY = diff > 0 ? diff : diff * 0.15;
      dialog.style.transform = `translateY(${translateY}px)`;
    }
    
    const maxOpacity = slideFromRight ? 0.15 : (isFullscreen ? 1 : 0.45);
    const progress = Math.min(Math.max(0, diff) / 450, 1);
    overlay.style.backgroundColor = `rgba(0, 0, 0, ${maxOpacity * (1 - progress)})`;
  };

  const onTouchEnd = () => {
    if (!isDragging) return;
    isDragging = false;
    const diff = slideFromRight ? (currentX - startX) : (currentY - startY);
    const duration = Date.now() - startTime;
    const velocity = diff / duration;

    // Standard fluid transition back or away
    dialog.style.transition = 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)';
    overlay.style.transition = 'background-color 0.3s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.3s cubic-bezier(0.16, 1, 0.3, 1)';

    if (diff > 90 || (velocity > 0.35 && diff > 40)) {
      close();
    } else {
      const maxOpacity = slideFromRight ? 0.15 : (isFullscreen ? 1 : 0.45);
      dialog.style.transform = slideFromRight ? 'translateX(0)' : 'translateY(0)';
      overlay.style.opacity = '1';
      overlay.style.backgroundColor = `rgba(0, 0, 0, ${maxOpacity})`;
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

  if (!persistent && (!isFullscreen || slideFromRight)) {
    addListeners(handle);
    addListeners(headerDrag);

    if (fullSwipe) {
      addListeners(dialog);
    } else {
      dialog.addEventListener('touchstart', (e) => {
        const rect = dialog.getBoundingClientRect();
        const relativeY = e.touches[0].clientY - rect.top;
        const relativeX = e.touches[0].clientX - rect.left;
        
        const isEdgeTouch = slideFromRight ? (relativeX < 40 || e.target.closest('.chat-header-bar')) : (relativeY < 60 || e.target.closest('.chat-header-bar, .ticket-chat-header, .modal-handle'));
        const isInteractive = e.target.closest('input, select, textarea, button');
        const isScrollableContent = e.target.closest('.pm-scrollable-body, .chat-messages, #ticket-messages-container');
        if (isEdgeTouch && !isInteractive && (!isScrollableContent || relativeX < 40)) {
          onTouchStart(e);
        }
      }, { passive: true });
      dialog.addEventListener('touchmove', (e) => {
        if (isDragging) onTouchMove(e);
      }, { passive: true });
      dialog.addEventListener('touchend', (e) => {
        if (isDragging) onTouchEnd(e);
      });
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
      dialog.style.animation = 'none';
      dialog.offsetHeight; // Force reflow
      dialog.style.transition = 'transform 0.24s cubic-bezier(0.16, 1, 0.3, 1)';
      dialog.style.transform = modal.slideFromRight ? 'translateX(100%)' : 'translateY(100%)';
    }
    if (overlay) {
      overlay.style.transition = 'background-color 0.24s ease-out, opacity 0.24s ease-out';
      overlay.style.backgroundColor = 'rgba(0, 0, 0, 0)';
      overlay.style.opacity = '0';
    }

    setTimeout(() => {
      modalWrapper.remove();
      if (modal.onClose) {
        try { modal.onClose(); } catch (e) { console.error(e); }
      }
    }, 240);
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
