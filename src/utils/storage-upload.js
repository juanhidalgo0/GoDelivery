// GoDelivery — Upload a cropped/compressed data URL image to Firebase Storage.
// Replaces the old pattern of saving the base64 string directly into Firestore documents.

function dataUrlToBlob(dataUrl) {
  const [header, base64] = dataUrl.split(',');
  const mimeMatch = header.match(/data:(.*?);base64/);
  const mime = mimeMatch ? mimeMatch[1] : 'image/webp';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function extensionForMime(mime) {
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/png') return 'png';
  return 'webp';
}

/**
 * Uploads a data URL (as returned by openCropper) to Firebase Storage and returns its download URL.
 * If `value` is already a URL (not a data URL) it's returned unchanged — safe to call on edit flows
 * where the image wasn't changed.
 * @param {string} value - data:image/... base64 string, or an existing URL, or empty.
 * @param {string} path - Storage path without extension, e.g. `products/{comercioId}/{productId}`.
 * @returns {Promise<string>}
 */
export async function uploadDataUrlImage(value, path) {
  if (!value || typeof value !== 'string' || !value.startsWith('data:')) {
    return value || '';
  }
  const { ref, uploadBytes, getDownloadURL } = await import('firebase/storage');
  const { storage } = await import('../firebase.js');

  const blob = dataUrlToBlob(value);
  const ext = extensionForMime(blob.type);
  const fileRef = ref(storage, `${path}_${Date.now()}.${ext}`);
  const snap = await uploadBytes(fileRef, blob, { contentType: blob.type });
  return getDownloadURL(snap.ref);
}
