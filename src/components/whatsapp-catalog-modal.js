// GoDelivery — Catálogo online del comercio: link, QR y tarjeta para imprimir
import { showModal } from './modal.js';
import { showToast } from './toast.js';
import { icon } from '../utils/icons.js';
import QRCode from 'qrcode';
import { getStoreUrl } from '../utils/slug.js';
import { escapeHtml } from '../utils/escape.js';

export async function openWhatsAppCatalogModal(comercioId, commerceData = null) {
  if (!comercioId) return;
  // "Primeros pasos" del panel da por hecho este paso cuando el comercio abrió su link
  try { localStorage.setItem(`gd-comercio-shared-${comercioId}`, '1'); } catch (e) {}

  let fullData = commerceData;
  if (!fullData || !fullData.slug) {
    try {
      const { doc, getDoc } = await import('firebase/firestore');
      const { db } = await import('../firebase.js');
      const snap = await getDoc(doc(db, 'comercios', comercioId));
      if (snap.exists()) fullData = { id: snap.id, ...snap.data() };
    } catch (err) {
      console.warn('Error fetching commerce for catalog modal:', err);
    }
  }

  const commerceName = fullData?.name || 'Tu comercio';
  const storeUrl = getStoreUrl(fullData || comercioId);
  const safeName = commerceName.replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ]+/g, '_').replace(/^_|_$/g, '') || 'comercio';
  const shareText = `¡Hola! 👋 Mirá nuestro catálogo y hacé tu pedido online, a domicilio o para retirar: ${storeUrl}`;

  const el = document.createElement('div');
  el.style.cssText = 'padding:30px 16px 22px; display:flex; flex-direction:column; gap:16px; color:var(--go-text, #0b0b0c); font-family:Inter,system-ui,sans-serif; max-width:460px; width:100%; margin:0 auto; box-sizing:border-box;';
  const card = 'background:var(--go-card,#fff); border:1px solid var(--go-line,#e4dfd6); border-radius:18px; padding:14px;';
  const btn = 'height:44px; border-radius:14px; border:1px solid var(--go-line,#e4dfd6); background:var(--go-card,#fff); color:var(--go-text,#0b0b0c); font:600 13.5px Inter,system-ui,sans-serif; display:flex; align-items:center; justify-content:center; gap:8px; cursor:pointer; text-decoration:none; flex:1; min-width:0;';
  el.innerHTML = `
    <div>
      <div style="font:700 11px Inter,system-ui,sans-serif; letter-spacing:.08em; text-transform:uppercase; color:var(--go-text-3,#78716c);">Tu catálogo online</div>
      <h3 style="margin:4px 0 0; font:800 21px var(--go-font, Montserrat, sans-serif); letter-spacing:-.01em;">${escapeHtml(commerceName)}</h3>
      <p style="margin:6px 0 0; font-size:13px; line-height:1.45; color:var(--go-text-2,#57534e);">Tus clientes ven tu catálogo, eligen y te piden a domicilio o para retirar. Los pedidos te llegan acá, al panel.</p>
    </div>

    <div style="${card} display:flex; flex-direction:column; gap:10px;">
      <div style="display:flex; align-items:center; gap:8px; background:var(--go-paper,#f4f2ee); border-radius:12px; padding:6px 6px 6px 12px;">
        <span style="flex:1; min-width:0; font-size:12.5px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(storeUrl.replace(/^https?:\/\//, ''))}</span>
        <button id="cat-copy" style="height:34px; padding:0 12px; border-radius:10px; border:0; background:var(--go-ink,#0b0b0c); color:#fff; font:600 12.5px Inter,system-ui,sans-serif; display:flex; align-items:center; gap:6px; cursor:pointer; flex-shrink:0;">${icon('copy', 14)} Copiar</button>
      </div>
      <div style="display:flex; gap:8px;">
        <a href="https://api.whatsapp.com/send?text=${encodeURIComponent(shareText)}" target="_blank" rel="noopener noreferrer" style="${btn} background:#25D366; border-color:#25D366; color:#fff;">${icon('whatsapp', 17)} Compartir</a>
        <a href="${escapeHtml(storeUrl)}" target="_blank" rel="noopener noreferrer" style="${btn}">${icon('eye', 16)} Ver catálogo</a>
      </div>
    </div>

    <div style="${card} display:flex; flex-direction:column; gap:12px;">
      <div>
        <div style="font:800 15.5px var(--go-font, Montserrat, sans-serif);">Tarjeta con tu QR</div>
        <div style="margin-top:3px; font-size:12.5px; color:var(--go-text-2,#57534e); line-height:1.4;">Para el mostrador, el delivery o la vidriera. Al escanearla abren tu catálogo. Tarjeta vertical de 5 × 9 cm, lista para imprenta.</div>
      </div>
      <div id="cat-card-preview" style="aspect-ratio:50/90; width:min(100%, 230px); align-self:center; border-radius:10px; overflow:hidden; background:var(--go-paper-2,#ebe7e0); display:flex; align-items:center; justify-content:center; color:var(--go-text-3,#78716c); font-size:12.5px; box-shadow:0 6px 18px rgba(11,11,12,.12);">Armando tu tarjeta…</div>
      <div style="display:flex; gap:8px;">
        <button id="cat-card-dl" style="${btn} background:var(--go-ink,#0b0b0c); border-color:var(--go-ink,#0b0b0c); color:#fff;" disabled>${icon('download', 16)} Descargar tarjeta</button>
        <button id="cat-sheet-dl" style="${btn}" disabled>${icon('grid', 16)} Hoja A4 (12)</button>
      </div>
      <button id="cat-qr-dl" style="align-self:center; border:0; background:none; color:var(--go-text-2,#57534e); font:600 12.5px Inter,system-ui,sans-serif; text-decoration:underline; cursor:pointer; padding:2px;">Descargar solo el QR</button>
    </div>
  `;

  showModal({ title: '', hideHeader: true, height: 'auto', content: el });

  el.querySelector('#cat-copy').onclick = async (e) => {
    const b = e.currentTarget;
    try {
      await navigator.clipboard.writeText(storeUrl);
      b.innerHTML = `${icon('check', 14)} Copiado`;
      setTimeout(() => { b.innerHTML = `${icon('copy', 14)} Copiar`; }, 2200);
    } catch (err) {
      showToast(storeUrl, 'info');
    }
  };

  const { renderStoreCard, renderPrintSheet, saveCanvasImage } = await import('../utils/store-card.js');
  let cardCanvas = null;
  try {
    cardCanvas = await renderStoreCard(fullData || { name: commerceName }, storeUrl);
    const preview = el.querySelector('#cat-card-preview');
    preview.innerHTML = '';
    const img = new Image();
    img.src = cardCanvas.toDataURL('image/png');
    img.alt = `Tarjeta de ${commerceName}`;
    // content-visibility: a global rule gives images 'auto', and this one then never painted
    img.style.cssText = 'width:100%; height:100%; display:block; content-visibility:visible;';
    preview.appendChild(img);
    el.querySelector('#cat-card-dl').disabled = false;
    el.querySelector('#cat-sheet-dl').disabled = false;
  } catch (err) {
    console.error('Error rendering store card:', err);
    el.querySelector('#cat-card-preview').textContent = 'No se pudo armar la tarjeta. Probá de nuevo.';
  }

  const save = async (button, canvas, fileName) => {
    const original = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `${icon('loader', 16, 'animate-spin')} Preparando…`;
    try {
      const how = await saveCanvasImage(canvas, fileName, comercioId);
      if (how === 'download') showToast('Imagen descargada', 'success');
      else if (how === 'opened') showToast('Se abrió la imagen: guardala o imprimila desde ahí', 'info');
    } catch (err) {
      console.error('Error saving image:', err);
      showToast('No se pudo guardar la imagen', 'error');
    } finally {
      button.disabled = false;
      button.innerHTML = original;
    }
  };

  el.querySelector('#cat-card-dl').onclick = (e) => cardCanvas && save(e.currentTarget, cardCanvas, `Tarjeta-GO-${safeName}.png`);
  el.querySelector('#cat-sheet-dl').onclick = (e) => cardCanvas && save(e.currentTarget, renderPrintSheet(cardCanvas), `Tarjetas-A4-GO-${safeName}.png`);
  el.querySelector('#cat-qr-dl').onclick = async (e) => {
    const c = document.createElement('canvas');
    await QRCode.toCanvas(c, storeUrl, { width: 1200, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#0b0b0c', light: '#ffffff' } });
    save(e.currentTarget, c, `QR-GO-${safeName}.png`);
  };
}
