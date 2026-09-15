// GoDelivery — WhatsApp Catalog & QR Sharing Modal
import { showModal, closeModal } from './modal.js';
import { showToast } from './toast.js';
import { icon } from '../utils/icons.js';
import QRCode from 'qrcode';
import { getStoreUrl } from '../utils/slug.js';

export async function openWhatsAppCatalogModal(comercioId, commerceData = null) {
  if (!comercioId) return;

  let fullData = commerceData;
  if (!fullData || !fullData.slug) {
    try {
      const { doc, getDoc } = await import('firebase/firestore');
      const { db } = await import('../firebase.js');
      const snap = await getDoc(doc(db, 'comercios', comercioId));
      if (snap.exists()) {
        fullData = { id: snap.id, ...snap.data() };
      }
    } catch (err) {
      console.warn('Error fetching commerce for WhatsApp modal:', err);
    }
  }

  const commerceName = fullData?.name || 'Tu Comercio';
  const logoUrl = fullData?.logo || fullData?.image || '/logo.png';
  const storeUrl = getStoreUrl(fullData || comercioId);

  let qrDataUrl = '';
  try {
    qrDataUrl = await QRCode.toDataURL(storeUrl, {
      width: 400,
      margin: 2,
      color: {
        dark: '#111827',
        light: '#ffffff'
      }
    });
  } catch (err) {
    console.error('Error generating QR code:', err);
  }

  const shareText = `¡Hola! 👋 Ya podés ver nuestra carta completa y hacer tu pedido online directamente desde acá: ${storeUrl} ¡Fácil, rápido y sin demoras! 🛍️`;

  const modalEl = document.createElement('div');
  modalEl.style.cssText = 'padding: 20px 16px 24px 16px; font-family: var(--font-body); display: flex; flex-direction: column; gap: 16px; color: var(--color-text-primary); text-align: center; max-width: 420px; width: 100%; box-sizing: border-box;';

  modalEl.innerHTML = `
    <!-- Header with badge -->
    <div style="display: flex; flex-direction: column; align-items: center; gap: 8px;">
      <div style="background: rgba(16, 185, 129, 0.1); color: #10b981; font-size: 11px; font-weight: 900; padding: 4px 12px; border-radius: 100px; text-transform: uppercase; letter-spacing: 0.05em; display: inline-flex; align-items: center; gap: 4px; border: 1px solid rgba(16, 185, 129, 0.2);">
        <span>💬 Catálogo WhatsApp & Tienda Directa</span>
      </div>
      <h3 style="font-family: var(--font-display); font-size: 20px; font-weight: 900; margin: 0; color: var(--color-text-primary); line-height: 1.2;">
        ${commerceName}
      </h3>
      <p style="font-size: 12.5px; color: var(--color-text-secondary); margin: 0; line-height: 1.45;">
        Tus clientes entran directamente a tu menú, eligen qué pedir (a domicilio o retiro en el local) y los pedidos te llegan directo a tu panel.
      </p>
    </div>

    <!-- QR Code Card -->
    <div style="background: var(--color-bg-secondary); border: 1.5px solid var(--color-border-light); border-radius: 20px; padding: 18px; display: flex; flex-direction: column; align-items: center; gap: 12px; box-shadow: var(--shadow-sm);">
      <div style="background: white; padding: 10px; border-radius: 16px; box-shadow: 0 4px 14px rgba(0,0,0,0.06); border: 1px solid rgba(0,0,0,0.06); display: flex; align-items: center; justify-content: center;">
        ${qrDataUrl ? `
          <img id="catalog-qr-img" src="${qrDataUrl}" alt="QR Catálogo" style="width: 190px; height: 190px; display: block; border-radius: 8px;" />
        ` : `
          <div style="width: 190px; height: 190px; display: flex; align-items: center; justify-content: center; color: var(--color-text-tertiary);">Generando QR...</div>
        `}
      </div>
      <span style="font-size: 11px; font-weight: 750; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: 0.04em;">
        📱 Escaneá para abrir tu tienda
      </span>
    </div>

    <!-- Store URL Copy Box -->
    <div style="background: var(--color-surface); border: 1.5px solid var(--color-border-light); border-radius: 14px; padding: 8px 8px 8px 12px; display: flex; align-items: center; justify-content: space-between; gap: 8px; box-shadow: var(--shadow-xs);">
      <span id="catalog-store-url" style="font-size: 12px; font-weight: 700; color: var(--color-text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; flex: 1;">
        ${storeUrl}
      </span>
      <button id="modal-copy-link-btn" style="background: var(--color-bg-secondary); border: 1px solid var(--color-border-light); color: var(--color-primary); font-size: 11.5px; font-weight: 850; padding: 7px 12px; border-radius: 10px; cursor: pointer; display: flex; align-items: center; gap: 4px; flex-shrink: 0; transition: all 0.2s;">
        ${icon('clipboard', 13)} Copiar
      </button>
    </div>

    <!-- Action Buttons -->
    <div style="display: flex; flex-direction: column; gap: 8px; width: 100%;">
      <!-- WhatsApp Share Button -->
      <a id="modal-share-wa-btn" href="https://api.whatsapp.com/send?text=${encodeURIComponent(shareText)}" target="_blank" rel="noopener noreferrer" style="height: 48px; background: #25D366; color: white; border-radius: 14px; text-decoration: none; font-weight: 900; font-size: 14px; display: flex; align-items: center; justify-content: center; gap: 8px; box-shadow: 0 4px 14px rgba(37,211,102,0.3); transition: transform 0.2s;">
        ${icon('whatsapp', 18)} Compartir en WhatsApp
      </a>

      <div style="display: flex; gap: 8px;">
        <!-- Download QR Button -->
        <button id="modal-download-qr-btn" style="flex: 1; height: 42px; background: var(--color-bg-secondary); border: 1.5px solid var(--color-border-light); color: var(--color-text-primary); border-radius: 12px; font-weight: 800; font-size: 12.5px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; transition: all 0.2s;">
          ${icon('download', 15)} Descargar QR
        </button>

        <!-- Close Button -->
        <button id="modal-close-catalog-btn" style="flex: 1; height: 42px; background: var(--color-bg-secondary); border: 1.5px solid var(--color-border-light); color: var(--color-text-secondary); border-radius: 12px; font-weight: 800; font-size: 12.5px; cursor: pointer; display: flex; align-items: center; justify-content: center;">
          Cerrar
        </button>
      </div>
    </div>
  `;

  const { close } = showModal({
    title: '',
    hideHeader: true,
    height: 'auto',
    content: modalEl
  });

  // Copy link handler
  const copyBtn = modalEl.querySelector('#modal-copy-link-btn');
  if (copyBtn) {
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(storeUrl).then(() => {
        showToast('¡Enlace copiado al portapapeles! 📋', 'success');
        copyBtn.innerHTML = `${icon('check', 13)} ¡Copiado!`;
        copyBtn.style.color = 'var(--color-success)';
        setTimeout(() => {
          copyBtn.innerHTML = `${icon('clipboard', 13)} Copiar`;
          copyBtn.style.color = 'var(--color-primary)';
        }, 2500);
      }).catch(() => {
        showToast(`Enlace: ${storeUrl}`, 'info');
      });
    };
  }

  // Download QR handler
  const downloadBtn = modalEl.querySelector('#modal-download-qr-btn');
  if (downloadBtn && qrDataUrl) {
    downloadBtn.onclick = () => {
      const a = document.createElement('a');
      a.href = qrDataUrl;
      a.download = `QR-GoDelivery-${commerceName.replace(/[^a-zA-Z0-9]/g, '_')}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      showToast('QR descargado con éxito 📥', 'success');
    };
  }

  // Close modal handler
  const closeBtn = modalEl.querySelector('#modal-close-catalog-btn');
  if (closeBtn) {
    closeBtn.onclick = () => close();
  }
}
