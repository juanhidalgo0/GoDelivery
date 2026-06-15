// GoDelivery — Premium Toast Notification System
import { icon } from '../utils/icons.js';

const activeToasts = new Set();

export function showToast(message, type = 'info', duration = 2500) {
  if (true) return; // Toasts disabled per user request
  if (activeToasts.has(message)) return;
  activeToasts.add(message);

  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  const icons = {
    success: icon('checkCircle', 20),
    error: icon('xCircle', 20),
    warning: icon('alertTriangle', 20),
    info: icon('info', 20)
  };

  const toast = document.createElement('div');
  toast.className = `modern-toast toast-${type}`;
  toast.innerHTML = `
    <div class="toast-content">
      <div class="toast-icon">
        ${icons[type] || icons.info}
      </div>
      <div class="toast-message">${message}</div>
    </div>
    <div class="toast-progress-bar"></div>
  `;

  container.appendChild(toast);

  // Trigger entry animation
  requestAnimationFrame(() => {
    toast.classList.add('visible');
  });

  const progressBar = toast.querySelector('.toast-progress-bar');
  
  // High-performance progress bar animation
  progressBar.style.transition = `transform ${duration}ms linear`;
  setTimeout(() => {
    progressBar.style.transform = 'scaleX(0)';
  }, 10);

  const closeToast = () => {
    if (toast.classList.contains('leaving')) return;
    activeToasts.delete(message);
    toast.classList.remove('visible');
    toast.classList.add('leaving');
    setTimeout(() => {
      toast.remove();
      const cont = document.getElementById('toast-container');
      if (cont && cont.children.length === 0) cont.remove();
    }, 600);
  };

  const timer = setTimeout(closeToast, duration);

  // Click to dismiss
  toast.onclick = closeToast;

  // Pause on hover
  toast.onmouseenter = () => {
    clearTimeout(timer);
    const computedStyle = window.getComputedStyle(progressBar);
    const matrix = new WebKitCSSMatrix(computedStyle.transform);
    const currentScale = matrix.m11;
    progressBar.style.transition = 'none';
    progressBar.style.transform = `scaleX(${currentScale})`;
  };

  toast.onmouseleave = () => {
    const computedStyle = window.getComputedStyle(progressBar);
    const matrix = new WebKitCSSMatrix(computedStyle.transform);
    const currentScale = matrix.m11;
    const remainingTime = duration * currentScale;
    progressBar.style.transition = `transform ${remainingTime}ms linear`;
    progressBar.style.transform = 'scaleX(0)';
    setTimeout(closeToast, remainingTime);
  };
}
