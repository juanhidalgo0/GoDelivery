// GoDelivery — High-Performance Image Compression Utility
/**
 * Compresses an image (Base64 or URL) using Canvas to a highly optimized WebP format (fallback to JPEG).
 * Reduces base64 string sizes by up to 90% while maintaining premium visual quality.
 * 
 * @param {string} base64OrUrl - The source image base64 or URL.
 * @param {number} maxWidth - Maximum allowed width.
 * @param {number} maxHeight - Maximum allowed height.
 * @param {number} quality - Compression quality (0.0 to 1.0).
 * @returns {Promise<string>} - Optimized WebP/JPEG Base64 string.
 */
export function compressImage(base64OrUrl, maxWidth = 800, maxHeight = 800, quality = 0.75) {
  return new Promise((resolve) => {
    if (!base64OrUrl) {
      resolve('');
      return;
    }

    // Skip if it's already a tiny placeholder or not a standard image source
    if (!base64OrUrl.startsWith('data:image/') && !base64OrUrl.startsWith('http')) {
      resolve(base64OrUrl);
      return;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      let width = img.width;
      let height = img.height;

      // Calculate proportional dimensions keeping aspect ratio
      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      }
      if (height > maxHeight) {
        width = Math.round((width * maxHeight) / height);
        height = maxHeight;
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, width, height);

      try {
        // Try WebP compression first
        let compressed = canvas.toDataURL('image/webp', quality);
        if (!compressed.startsWith('data:image/webp')) {
          // Fallback to JPEG if browser doesn't support WebP export
          compressed = canvas.toDataURL('image/jpeg', quality);
        }
        resolve(compressed);
      } catch (err) {
        console.error('Canvas export failed, using original image:', err);
        resolve(base64OrUrl);
      }
    };

    img.onerror = (err) => {
      console.error('Image loading for compression failed, keeping original:', err);
      resolve(base64OrUrl);
    };

    img.src = base64OrUrl;
  });
}

/**
 * Compresses an image File or Blob directly to a lightweight WebP File/Blob (max 1200px, quality 0.82)
 * @param {File|Blob} file 
 * @param {number} maxWidth 
 * @param {number} maxHeight 
 * @param {number} quality 
 * @returns {Promise<File|Blob>}
 */
export async function compressImageFile(file, maxWidth = 1200, maxHeight = 1200, quality = 0.82) {
  if (!file || !(file instanceof Blob)) return file;
  if (file.type && !file.type.startsWith('image/')) return file;

  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      let width = img.width;
      let height = img.height;

      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      }
      if (height > maxHeight) {
        width = Math.round((width * maxHeight) / height);
        height = maxHeight;
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob((blob) => {
        if (!blob) {
          resolve(file);
          return;
        }
        const fileName = (file.name || 'upload.webp').replace(/\.[^/.]+$/, "") + ".webp";
        const compressedFile = new File([blob], fileName, { type: 'image/webp' });
        resolve(compressedFile);
      }, 'image/webp', quality);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(file);
    };
    img.src = objectUrl;
  });
}

