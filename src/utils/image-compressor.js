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
