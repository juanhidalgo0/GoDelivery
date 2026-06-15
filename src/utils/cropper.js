// GoDelivery — Image Cropper Utility
import { showModal, closeModal } from '../components/modal.js';
import { icon } from './icons.js';

/**
 * Opens a modal to crop an image.
 * @param {File|string} imageSource - The image file or URL to crop.
 * @param {Object} options - Cropper options (aspectRatio, etc).
 * @returns {Promise<string>} - The cropped image as Base64 string.
 */
export function openCropper(imageSource, options = {}) {
  return new Promise((resolve, reject) => {
    const defaultOptions = {
      aspectRatio: 1, // Square by default
      viewMode: 1,
      dragMode: 'move',
      autoCropArea: 1,
      restore: false,
      guides: true,
      center: true,
      highlight: false,
      cropBoxMovable: true,
      cropBoxResizable: true,
      toggleDragModeOnDblclick: false,
      ...options
    };

    let cropper = null;
    let imageObjectUrl = null;

    if (imageSource instanceof File) {
      imageObjectUrl = URL.createObjectURL(imageSource);
    } else {
      imageObjectUrl = imageSource;
    }

    showModal({
      title: 'Ajustar imagen',
      content: `
        <div class="cropper-container ${options.circular ? 'circular-cropper' : ''}" style="max-height: 400px; overflow: hidden; background: #000; border-radius: var(--radius-lg);">
          <img id="cropper-image" src="${imageObjectUrl}" style="max-width: 100%; display: block;" />
        </div>
        ${options.circular ? `
        <style>
          .circular-cropper .cropper-view-box,
          .circular-cropper .cropper-face {
            border-radius: 50% !important;
          }
        </style>
        ` : ''}
        <div class="cropper-toolbar" style="display: flex; justify-content: center; gap: var(--space-4); margin-top: var(--space-4);">
          <button class="btn btn-sm btn-ghost" id="crop-rotate-l" title="Rotar izquierda">${icon('rotateCcw', 18)}</button>
          <button class="btn btn-sm btn-ghost" id="crop-rotate-r" title="Rotar derecha">${icon('rotateCw', 18)}</button>
          <button class="btn btn-sm btn-ghost" id="crop-zoom-in" title="Aumentar">${icon('plus', 18)}</button>
          <button class="btn btn-sm btn-ghost" id="crop-zoom-out" title="Disminuir">${icon('minus', 18)}</button>
        </div>
      `,
      footer: `
        <button class="btn btn-ghost" id="crop-cancel">Cancelar</button>
        <button class="btn btn-primary" id="crop-done">Listo</button>
      `,
      onClose: () => {
        if (imageSource instanceof File && imageObjectUrl) {
          URL.revokeObjectURL(imageObjectUrl);
        }
        if (cropper) cropper.destroy();
      }
    });

    const imageElement = document.getElementById('cropper-image');
    
    // Initialize Cropper when modal is ready
    // We use a small timeout to ensure the image is rendered
    setTimeout(() => {
      cropper = new Cropper(imageElement, defaultOptions);

      // Toolbar actions
      document.getElementById('crop-rotate-l')?.addEventListener('click', () => cropper.rotate(-90));
      document.getElementById('crop-rotate-r')?.addEventListener('click', () => cropper.rotate(90));
      document.getElementById('crop-zoom-in')?.addEventListener('click', () => cropper.zoom(0.1));
      document.getElementById('crop-zoom-out')?.addEventListener('click', () => cropper.zoom(-0.1));

      document.getElementById('crop-cancel')?.addEventListener('click', () => {
        closeModal();
        reject('Cancelled');
      });

      document.getElementById('crop-done')?.addEventListener('click', () => {
        const canvas = cropper.getCroppedCanvas({
          width: options.maxWidth || 800,
          height: options.maxHeight || 800,
          imageSmoothingEnabled: true,
          imageSmoothingQuality: 'high',
        });

        let croppedBase64 = canvas.toDataURL('image/webp', 0.75);
        if (!croppedBase64.startsWith('data:image/webp')) {
          croppedBase64 = canvas.toDataURL('image/jpeg', 0.75);
        }
        closeModal();
        resolve(croppedBase64);
      });
    }, 100);
  });
}
