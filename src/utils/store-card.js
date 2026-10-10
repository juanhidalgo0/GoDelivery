// Tarjeta imprimible del comercio con su QR al catálogo online (estilo GO).
//
// renderStoreCard dibuja una tarjeta vertical de 5 × 9 cm a 600 ppp (1181 × 2126 px):
// arriba, sobre tinta, el logo real del comercio, su nombre y su rubro; al medio, una placa
// blanca con el QR que abre #/tienda/<slug>; abajo, sobre papel, la invitación a pedir.
// renderPrintSheet arma una hoja A4 a 300 ppp con 12 tarjetas y marcas de corte.
// saveCanvasImage la guarda: descarga en el navegador; en la app instalada (sin plugins de
// archivos en el binario) usa el menú de compartir o la sube y la abre en el navegador del sistema.

import QRCode from 'qrcode';
import { storeInitials } from './store-initials.js';

export { storeInitials };

const INK = '#0b0b0c';
const INK_2 = '#1c1c1f';
const PAPER = '#f4f2ee';
const RED = '#e11d48';
const MUTED = '#a8a29e';
const TEXT2 = '#57534e';

const CARD_W = 1181;   // 50 mm a 600 ppp
const CARD_H = 2126;   // 90 mm
const MM = CARD_W / 50;

function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    if (src.startsWith('data:')) {
      // Muchos logos están guardados dentro del doc (data URL): se usan tal cual. Antes se les
      // agregaba "?card=1" y eso los rompía, así que la tarjeta salía con las iniciales.
      img.src = src;
      return;
    }
    img.crossOrigin = 'anonymous'; // sin esto la imagen "ensucia" el canvas y no se puede exportar
    // Parámetro aparte: una copia cacheada sin CORS (de un <img> común) haría fallar la carga
    img.src = src + (src.includes('?') ? '&' : '?') + 'card=1';
  });
}

async function ensureFonts() {
  try {
    await Promise.all([
      document.fonts.load(`800 ${6 * MM}px Montserrat`),
      document.fonts.load(`900 ${3 * MM}px Montserrat`),
      document.fonts.load(`700 ${2 * MM}px Montserrat`),
      document.fonts.load(`500 ${2.6 * MM}px Inter`),
      document.fonts.load(`600 ${2.6 * MM}px Inter`),
    ]);
  } catch (e) { /* se dibuja con la fuente del sistema */ }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Parte el texto en hasta `maxLines` renglones de ancho maxW, achicando la letra si hace falta. */
function fitLines(ctx, text, maxW, startPx, minPx, weight = 800, family = 'Montserrat, Inter, sans-serif', maxLines = 2) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const wrap = (px) => {
    ctx.font = `${weight} ${px}px ${family}`;
    const lines = [];
    let line = '';
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (ctx.measureText(next).width > maxW && line) { lines.push(line); line = w; } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  };
  for (let px = startPx; px >= minPx; px -= 2) {
    const lines = wrap(px);
    if (lines.length <= maxLines && lines.every(l => ctx.measureText(l).width <= maxW)) return { px, lines };
  }
  const lines = wrap(minPx);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1];
    while (ctx.measureText(last + '…').width > maxW && last.length > 2) last = last.slice(0, -1);
    kept[maxLines - 1] = last + '…';
    return { px: minPx, lines: kept };
  }
  return { px: minPx, lines };
}

/** El logo GO! (círculo tinta con "GO!" en blanco) centrado en (cx, cy). */
function goBadge(ctx, cx, cy, d) {
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.arc(cx, cy, d / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = `900 ${d * 0.36}px Montserrat, Inter, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('GO!', cx, cy + d * 0.02);
  ctx.textBaseline = 'alphabetic';
}

/**
 * La tarjeta del comercio. comercio: { name, logo, category }. url: link del catálogo.
 * Devuelve un canvas de 1181 × 2126 px (5 × 9 cm a 600 ppp).
 */
export async function renderStoreCard(comercio, url) {
  await ensureFonts();
  const canvas = document.createElement('canvas');
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d');
  // Sin emojis: impresos quedan desprolijos (y algunas impresoras los pierden)
  const name = (comercio?.name || 'Tu comercio').replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '').replace(/\s+/g, ' ').trim() || 'Tu comercio';
  const cx = CARD_W / 2;

  // Fondo: papel abajo, tinta arriba con un brillo suave (da profundidad sin distraer)
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  const inkH = 47.5 * MM;
  const glow = ctx.createRadialGradient(cx, 10 * MM, 2 * MM, cx, 18 * MM, 46 * MM);
  glow.addColorStop(0, INK_2);
  glow.addColorStop(1, INK);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, CARD_W, inkH);

  // Logo real en círculo con aro blanco
  const logoD = 18 * MM;
  const logoCY = 13 * MM;
  const ring = 1.1 * MM;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 3 * MM;
  ctx.shadowOffsetY = 0.8 * MM;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(cx, logoCY, logoD / 2 + ring, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  const logo = await loadImage(comercio?.logo);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, logoCY, logoD / 2, 0, Math.PI * 2);
  ctx.clip();
  if (logo) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(cx - logoD / 2, logoCY - logoD / 2, logoD, logoD);
    // "cover": llena el círculo sin deformar
    const s = Math.min(logo.naturalWidth, logo.naturalHeight);
    ctx.drawImage(logo, (logo.naturalWidth - s) / 2, (logo.naturalHeight - s) / 2, s, s, cx - logoD / 2, logoCY - logoD / 2, logoD, logoD);
  } else {
    ctx.fillStyle = RED;
    ctx.fillRect(cx - logoD / 2, logoCY - logoD / 2, logoD, logoD);
    ctx.fillStyle = '#ffffff';
    ctx.font = `900 ${8 * MM}px Montserrat, Inter, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(storeInitials(name), cx, logoCY + 0.3 * MM);
    ctx.textBaseline = 'alphabetic';
  }
  ctx.restore();

  // Nombre (hasta 2 renglones, centrado) y rubro
  const textW = 42 * MM;
  const fit = fitLines(ctx, name, textW, Math.round(5 * MM), Math.round(3.2 * MM));
  ctx.font = `800 ${fit.px}px Montserrat, Inter, sans-serif`;
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  const lineH = fit.px * 1.08;
  let y = 25.2 * MM + fit.px * 0.74;
  fit.lines.forEach((line, i) => ctx.fillText(line, cx, y + i * lineH));
  y += (fit.lines.length - 1) * lineH;
  if (comercio?.category) {
    ctx.font = `600 ${2.3 * MM}px Inter, sans-serif`;
    ctx.fillStyle = MUTED;
    const cat = String(comercio.category).toUpperCase();
    // letras espaciadas, como etiqueta
    ctx.letterSpacing = `${0.35 * MM}px`;
    ctx.fillText(cat, cx, y + 4 * MM);
    ctx.letterSpacing = '0px';
  }

  // Placa del QR: flota sobre el corte entre tinta y papel
  const plate = 30 * MM;
  const plateX = cx - plate / 2;
  const plateY = 42.5 * MM;
  ctx.save();
  ctx.shadowColor = 'rgba(11,11,12,0.28)';
  ctx.shadowBlur = 3.5 * MM;
  ctx.shadowOffsetY = 1.2 * MM;
  roundRect(ctx, plateX, plateY, plate, plate, 4.2 * MM);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.restore();
  // Etiqueta roja arriba de la placa
  const tagText = 'MENÚ ONLINE';
  ctx.font = `800 ${1.75 * MM}px Montserrat, Inter, sans-serif`;
  ctx.letterSpacing = `${0.3 * MM}px`;
  const tagW = ctx.measureText(tagText).width + 4 * MM;
  const tagH = 3.6 * MM;
  roundRect(ctx, cx - tagW / 2, plateY - tagH / 2, tagW, tagH, tagH / 2);
  ctx.fillStyle = RED;
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(tagText, cx + 0.15 * MM, plateY + 0.1 * MM);
  ctx.textBaseline = 'alphabetic';
  ctx.letterSpacing = '0px';
  // QR
  const inset = 3 * MM;
  const qrSize = Math.round(plate - inset * 2);
  const qrCanvas = document.createElement('canvas');
  await QRCode.toCanvas(qrCanvas, url, { width: qrSize, margin: 0, errorCorrectionLevel: 'M', color: { dark: INK, light: '#ffffff' } });
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(qrCanvas, plateX + inset, plateY + inset, qrSize, qrSize);
  ctx.imageSmoothingEnabled = true;

  // Invitación
  const afterPlate = plateY + plate;
  ctx.textAlign = 'center';
  ctx.fillStyle = INK;
  ctx.font = `800 ${3.6 * MM}px Montserrat, Inter, sans-serif`;
  ctx.fillText('Escaneá y pedí', cx, afterPlate + 5.6 * MM);
  ctx.font = `500 ${2.15 * MM}px Inter, sans-serif`;
  ctx.fillStyle = TEXT2;
  ctx.fillText('Envío a domicilio o retiro en el local', cx, afterPlate + 9.1 * MM);

  // Firma: línea fina + "Pedí con [GO!] Delivery"
  const footY = CARD_H - 3.4 * MM;
  ctx.strokeStyle = 'rgba(11,11,12,0.12)';
  ctx.lineWidth = 0.2 * MM;
  ctx.beginPath();
  ctx.moveTo(cx - 12 * MM, footY - 4.4 * MM);
  ctx.lineTo(cx + 12 * MM, footY - 4.4 * MM);
  ctx.stroke();
  ctx.font = `600 ${2.1 * MM}px Inter, sans-serif`;
  const pre = 'Pedí con', post = 'Delivery';
  const badge = 3.6 * MM, gap = 0.9 * MM;
  const wPre = ctx.measureText(pre).width, wPost = ctx.measureText(post).width;
  let bx = cx - (wPre + gap + badge + gap + wPost) / 2;
  ctx.textAlign = 'left';
  ctx.fillStyle = TEXT2;
  ctx.fillText(pre, bx, footY);
  bx += wPre + gap;
  goBadge(ctx, bx + badge / 2, footY - 0.72 * MM, badge);
  bx += badge + gap;
  ctx.textAlign = 'left';
  ctx.fillStyle = TEXT2;
  ctx.font = `600 ${2.1 * MM}px Inter, sans-serif`;
  ctx.fillText(post, bx, footY);

  return canvas;
}

/** Hoja A4 a 300 ppp (2480 × 3508) con 12 tarjetas de 5 × 9 cm y marcas de corte. */
export function renderPrintSheet(card) {
  const W = 2480, H = 3508;
  const cw = Math.round(card.width / 2), ch = Math.round(card.height / 2); // 600 → 300 ppp
  const cols = Math.floor((W - 160) / cw), rows = Math.floor((H - 260) / ch);
  const x0 = Math.round((W - cw * cols) / 2), y0 = Math.round((H - ch * rows) / 2);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.imageSmoothingQuality = 'high';
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) ctx.drawImage(card, x0 + c * cw, y0 + r * ch, cw, ch);
  // Marcas de corte afuera de las tarjetas
  ctx.strokeStyle = '#9ca3af';
  ctx.lineWidth = 2;
  const mark = 36, off = 10;
  const xs = Array.from({ length: cols + 1 }, (_, i) => x0 + i * cw);
  const ys = Array.from({ length: rows + 1 }, (_, i) => y0 + i * ch);
  ctx.beginPath();
  xs.forEach(x => { ctx.moveTo(x, y0 - off); ctx.lineTo(x, y0 - off - mark); ctx.moveTo(x, y0 + rows * ch + off); ctx.lineTo(x, y0 + rows * ch + off + mark); });
  ys.forEach(y => { ctx.moveTo(x0 - off, y); ctx.lineTo(x0 - off - mark, y); ctx.moveTo(x0 + cols * cw + off, y); ctx.lineTo(x0 + cols * cw + off + mark, y); });
  ctx.stroke();
  ctx.fillStyle = '#9ca3af';
  ctx.font = '500 28px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`Imprimí al 100 % (sin "ajustar a la página") y cortá por las marcas · ${cols * rows} tarjetas de 5 × 9 cm`, W / 2, H - 60);
  return canvas;
}

const isNative = () => !!window.Capacitor?.isNativePlatform?.();

/** Guarda la imagen. Devuelve 'download' | 'share' | 'opened'. */
export async function saveCanvasImage(canvas, fileName, comercioId) {
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  if (!blob) throw new Error('No se pudo generar la imagen');

  if (!isNative()) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return 'download';
  }

  // App instalada: el menú de compartir (Guardar imagen, WhatsApp, Drive...) si el sistema lo ofrece
  const file = new File([blob], fileName, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: fileName });
      return 'share';
    } catch (e) {
      if (e?.name === 'AbortError') return 'share';
    }
  }
  // Si no: se sube y se abre en el navegador del celular, que la deja guardar o imprimir
  const { ref, uploadBytes, getDownloadURL } = await import('firebase/storage');
  const { storage } = await import('../firebase.js');
  const fileRef = ref(storage, `comercios/${comercioId}/tarjetas/${Date.now()}_${fileName}`);
  await uploadBytes(fileRef, blob, { contentType: 'image/png' });
  const url = await getDownloadURL(fileRef);
  window.open(url, '_system');
  return 'opened';
}
