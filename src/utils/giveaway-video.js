// Video del sorteo para stories (1080×1920), el mismo show que ve la gente en /sorteo.html:
// presentación, cuenta regresiva 5→1, cada ganador con su premio y confeti, resultado oficial y
// cierre con GO!. Se dibuja en un canvas y se graba con MediaRecorder en tiempo real (≈25-30 s),
// así que la pantalla tiene que quedar abierta mientras se genera.
//
// MP4 (H.264) donde el navegador lo graba (Chrome 126+, Safari): es lo que Instagram acepta.
// Si no, WebM.

const W = 1080;
const H = 1920;
const FPS = 30;

const C = {
  ink: '#0b0b0c',
  ink2: '#16161b',
  line: 'rgba(255,255,255,0.12)',
  text: '#ffffff',
  text2: 'rgba(255,255,255,0.72)',
  red: '#e11d48',
  gold: '#f5b50b',
  paper: '#f7f5f1',
};
const CONF_COLORS = ['#e11d48', '#f5b50b', '#ffffff', '#22c55e', '#38bdf8', '#f97316'];

// Tiempos de cada parte (segundos)
const T_INTRO = 3;
const T_COUNT = 5;            // 5, 4, 3, 2, 1
const T_WINNER = 3.6;
const T_LAST_WINNER = 4.2;
const T_SUMMARY = 4.5;
const T_OUTRO = 3;

export function pickVideoMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  const options = [
    ['video/mp4;codecs=avc1.42E01E', 'mp4'],
    ['video/mp4;codecs=avc1', 'mp4'],
    ['video/mp4', 'mp4'],
    ['video/webm;codecs=vp9', 'webm'],
    ['video/webm;codecs=vp8', 'webm'],
    ['video/webm', 'webm'],
  ];
  for (const [mime, ext] of options) {
    try { if (MediaRecorder.isTypeSupported(mime)) return { mime, ext }; } catch (e) {}
  }
  return null;
}

/** ¿Este dispositivo puede generar el video? */
export function canRenderGiveawayVideo() {
  return !!pickVideoMime() && typeof HTMLCanvasElement !== 'undefined' && !!HTMLCanvasElement.prototype.captureStream;
}

// ---------------------------------------------------------------- utilidades de dibujo

// Números al azar pero siempre los mismos (el confeti no "salta" entre cuadros)
function rng(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const easeOut = (x) => 1 - Math.pow(1 - clamp(x), 3);
// Rebote como cubic-bezier(.34,1.56,.64,1) de la página
const easeBack = (x) => { x = clamp(x); const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };

function loadImage(src, timeoutMs = 6000) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.crossOrigin = 'anonymous'; // sin esto el canvas queda "manchado" y no se puede grabar
    const done = (ok) => { clearTimeout(timer); resolve(ok ? img : null); };
    const timer = setTimeout(() => done(false), timeoutMs);
    img.onload = () => done(true);
    img.onerror = () => done(false);
    img.src = src;
  });
}

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || 'G';
}

function fitText(ctx, text, maxWidth, size, weight = 900, family = 'Montserrat') {
  let s = size;
  ctx.font = `${weight} ${s}px ${family}, system-ui, sans-serif`;
  while (ctx.measureText(text).width > maxWidth && s > 24) {
    s -= 2;
    ctx.font = `${weight} ${s}px ${family}, system-ui, sans-serif`;
  }
  return s;
}

// Corta un texto en hasta maxLines renglones que entren en maxWidth
function wrapLines(ctx, text, maxWidth, maxLines = 2) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(next).width <= maxWidth || !cur) cur = next;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    // Lo que no entra va al último renglón, recortado por letras (antes se borraba la última
    // palabra y un nombre de dos palabras en un renglón quedaba "…")
    const kept = lines.slice(0, maxLines - 1);
    kept.push(ellipsize(ctx, lines.slice(maxLines - 1).join(' '), maxWidth));
    return kept;
  }
  return lines.map(l => ellipsize(ctx, l, maxWidth));
}

function ellipsize(ctx, str, maxWidth) {
  if (ctx.measureText(str).width <= maxWidth) return str;
  let s = str;
  while (s.length > 1 && ctx.measureText(s + '…').width > maxWidth) s = s.slice(0, -1);
  return s.trimEnd() + '…';
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

function drawAvatar(ctx, img, name, cx, cy, r, ring = C.gold) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fillStyle = '#2a2a33';
  ctx.fill();
  ctx.clip();
  if (img) {
    const s = Math.max((2 * r) / img.width, (2 * r) / img.height);
    ctx.drawImage(img, cx - (img.width * s) / 2, cy - (img.height * s) / 2, img.width * s, img.height * s);
  } else {
    ctx.fillStyle = C.text;
    ctx.font = `900 ${Math.round(r * 0.8)}px Montserrat, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(initials(name), cx, cy + r * 0.04);
  }
  ctx.restore();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.lineWidth = Math.max(6, r * 0.08);
  ctx.strokeStyle = ring;
  ctx.stroke();
}

function text(ctx, str, x, y, { size = 48, weight = 800, color = C.text, family = 'Inter', align = 'center', alpha = 1, spacing = 0 } = {}) {
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px ${family}, system-ui, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  if (spacing && 'letterSpacing' in ctx) ctx.letterSpacing = `${spacing}px`;
  ctx.fillText(str, x, y);
  ctx.restore();
}

// Confeti que cae (desde que empieza la escena) y estallido desde el centro
function makeConfetti(seed, count) {
  const r = rng(seed);
  return Array.from({ length: count }, (_, i) => ({
    x: r() * W, delay: r() * 1.2, speed: 380 + r() * 520, sway: 20 + r() * 60, swayF: 1 + r() * 2,
    w: 14 + r() * 18, h: 8 + r() * 22, rot: r() * Math.PI, rotV: (r() - 0.5) * 8,
    color: CONF_COLORS[i % CONF_COLORS.length], round: r() > 0.6,
  }));
}
function drawConfetti(ctx, pieces, t) {
  for (const p of pieces) {
    const tt = t - p.delay;
    if (tt < 0) continue;
    const y = -40 + tt * p.speed;
    if (y > H + 40) continue;
    const x = p.x + Math.sin(tt * p.swayF) * p.sway;
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.translate(x, y);
    ctx.rotate(p.rot + tt * p.rotV);
    ctx.fillStyle = p.color;
    if (p.round) { ctx.beginPath(); ctx.arc(0, 0, p.w / 2.4, 0, Math.PI * 2); ctx.fill(); }
    else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
    ctx.restore();
  }
}
function makeBurst(seed, count) {
  const r = rng(seed);
  return Array.from({ length: count }, (_, i) => {
    const a = r() * Math.PI * 2;
    return { dx: Math.cos(a), dy: Math.sin(a), dist: 300 + r() * 520, s: 12 + r() * 16, color: CONF_COLORS[i % CONF_COLORS.length], round: i % 2 === 0, spin: (r() - 0.5) * 12 };
  });
}
function drawBurst(ctx, pieces, t, cx, cy) {
  if (t < 0 || t > 1.1) return;
  const k = easeOut(t / 0.9);
  for (const p of pieces) {
    ctx.save();
    ctx.globalAlpha = clamp(1 - t / 1.1);
    ctx.translate(cx + p.dx * p.dist * k, cy + p.dy * p.dist * k + 180 * t * t);
    ctx.rotate(p.spin * t);
    ctx.fillStyle = p.color;
    if (p.round) { ctx.beginPath(); ctx.arc(0, 0, p.s / 2, 0, Math.PI * 2); ctx.fill(); }
    else ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s);
    ctx.restore();
  }
}

// ---------------------------------------------------------------- escenas

function background(ctx, t) {
  ctx.fillStyle = C.ink;
  ctx.fillRect(0, 0, W, H);
  // Resplandor rojo arriba y dorado abajo, que respira despacio
  const pulse = 0.5 + 0.5 * Math.sin(t * 0.9);
  let g = ctx.createRadialGradient(W * 0.2, H * 0.12, 0, W * 0.2, H * 0.12, W * 0.95);
  g.addColorStop(0, `rgba(225,29,72,${0.30 + 0.08 * pulse})`);
  g.addColorStop(1, 'rgba(225,29,72,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  g = ctx.createRadialGradient(W * 0.85, H * 0.9, 0, W * 0.85, H * 0.9, W * 0.9);
  g.addColorStop(0, `rgba(245,181,11,${0.16 + 0.06 * (1 - pulse)})`);
  g.addColorStop(1, 'rgba(245,181,11,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function header(ctx, logo) {
  // Logo GO! y "Sorteo en vivo · Magdalena" arriba, siempre visibles
  const y = 190;
  if (logo) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(W / 2 - 250, y, 46, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(logo, W / 2 - 296, y - 46, 92, 92);
    ctx.restore();
  }
  text(ctx, 'SORTEO EN VIVO', W / 2 - 180, y - 6, { size: 40, weight: 900, family: 'Montserrat', align: 'left', spacing: 4 });
  text(ctx, 'GO! · MAGDALENA', W / 2 - 180, y + 40, { size: 30, weight: 700, color: C.text2, align: 'left', spacing: 3 });
}

function sceneIntro(ctx, t, data) {
  // Ya visible en el primer cuadro (es la portada del video en Instagram), con un leve movimiento
  const a = 0.55 + 0.45 * easeOut(t / 0.6);
  text(ctx, 'HOY SORTEAMOS', W / 2, 700, { size: 44, weight: 800, color: C.gold, alpha: a, spacing: 6 });
  ctx.save();
  ctx.globalAlpha = a;
  ctx.font = '900 112px Montserrat, system-ui, sans-serif';
  const lines = wrapLines(ctx, data.title.toUpperCase(), W - 160, 3);
  const size = fitText(ctx, lines.reduce((m, l) => (l.length > m.length ? l : m), ''), W - 160, 112);
  lines.forEach((l, i) => text(ctx, l, W / 2, 840 + i * (size * 1.05) + (1 - a) * 40, { size, weight: 900, family: 'Montserrat' }));
  ctx.restore();
  const b = 0.55 + 0.45 * easeOut((t - 0.3) / 0.6);
  if (data.participants > 0) {
    text(ctx, data.participants.toLocaleString('es-AR'), W / 2, 1290, { size: 150, weight: 900, family: 'Montserrat', color: C.text, alpha: b });
    text(ctx, data.participants === 1 ? 'PARTICIPANTE' : 'PARTICIPANTES', W / 2, 1360, { size: 40, weight: 800, color: C.text2, alpha: b, spacing: 6 });
  }
  if (data.date) text(ctx, data.date, W / 2, 1480, { size: 34, weight: 600, color: C.text2, alpha: b });
}

function sceneCountdown(ctx, t) {
  const n = 5 - Math.floor(t);
  const local = t - Math.floor(t);
  const cy = 1120; // centro del anillo y del número
  text(ctx, 'ELIGIENDO GANADORES', W / 2, 660, { size: 46, weight: 800, color: C.text2, spacing: 6 });
  // anillo que gira
  ctx.save();
  ctx.lineWidth = 10;
  ctx.strokeStyle = C.line;
  ctx.beginPath(); ctx.arc(W / 2, cy, 320, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = C.red;
  ctx.beginPath(); ctx.arc(W / 2, cy, 320, -Math.PI / 2 + t * 2.4, -Math.PI / 2 + t * 2.4 + 1.2); ctx.stroke();
  ctx.restore();
  const s = 1.8 - 0.8 * easeBack(local / 0.6);
  ctx.save();
  ctx.translate(W / 2, cy);
  ctx.scale(s, s);
  ctx.globalAlpha *= clamp(local / 0.25);
  ctx.fillStyle = n <= 3 ? C.gold : C.text;
  ctx.font = '900 400px Montserrat, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(n), 0, 14);
  ctx.restore();
}

function sceneWinner(ctx, t, w, img, fx) {
  text(ctx, `${w.position}° PREMIO`, W / 2, 620, { size: 56, weight: 900, family: 'Montserrat', color: C.gold, spacing: 6, alpha: clamp(t / 0.3) });
  // Tarjeta que gira al entrar (como el "flip" de la página). Primero se mide el contenido para
  // que la tarjeta tenga el alto justo (sin descripción quedaba medio vacía).
  const k = easeBack(t / 0.8);
  const cardW = 880, x = (W - cardW) / 2;
  ctx.font = '900 84px Montserrat, system-ui, sans-serif';
  const mLines = wrapLines(ctx, String(w.userName || 'Ganador/a').toUpperCase(), cardW - 120, 2);
  const mNs = fitText(ctx, mLines.reduce((m, l) => (l.length > m.length ? l : m), ''), cardW - 120, 84);
  ctx.font = '600 38px Inter, system-ui, sans-serif';
  const mDesc = w.prizeDescription ? wrapLines(ctx, w.prizeDescription, cardW - 140, 2).length : 0;
  const contentBottom = 520 + mLines.length * mNs * 1.08 + 30 + (mDesc ? 70 + (mDesc - 1) * 48 : 0);
  const cardH = Math.round(contentBottom + 90);
  const y = Math.round(700 + Math.max(0, (950 - cardH) / 2));
  ctx.save();
  ctx.translate(W / 2, y + cardH / 2);
  ctx.scale(Math.max(0.02, k) * (0.7 + 0.3 * k), 0.7 + 0.3 * k);
  ctx.globalAlpha = clamp(t / 0.35);
  ctx.translate(-W / 2, -(y + cardH / 2));
  ctx.shadowColor = 'rgba(245,181,11,0.45)';
  ctx.shadowBlur = 90;
  roundRect(ctx, x, y, cardW, cardH, 56);
  const g = ctx.createLinearGradient(x, y, x + cardW, y + cardH);
  g.addColorStop(0, '#1f1f27');
  g.addColorStop(1, '#131318');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(245,181,11,0.6)';
  ctx.stroke();
  drawAvatar(ctx, img, w.userName, W / 2, y + 230, 150);
  ctx.font = '900 84px Montserrat, system-ui, sans-serif';
  const nameLines = wrapLines(ctx, String(w.userName || 'Ganador/a').toUpperCase(), cardW - 120, 2);
  const ns = fitText(ctx, nameLines.reduce((m, l) => (l.length > m.length ? l : m), ''), cardW - 120, 84);
  nameLines.forEach((l, i) => text(ctx, l, W / 2, y + 500 + i * ns * 1.08, { size: ns, weight: 900, family: 'Montserrat' }));
  const prizeY = y + 520 + nameLines.length * ns * 1.08 + 30;
  const prize = String(w.prizeAmount || '');
  if (prize) {
    const ps = (() => { ctx.font = '900 104px Montserrat, system-ui, sans-serif'; return fitText(ctx, prize, cardW - 120, 104); })();
    text(ctx, prize, W / 2, prizeY, { size: ps, weight: 900, family: 'Montserrat', color: C.gold });
  }
  if (w.prizeDescription) {
    ctx.font = '600 38px Inter, system-ui, sans-serif';
    wrapLines(ctx, w.prizeDescription, cardW - 140, 2).forEach((l, i) => text(ctx, l, W / 2, prizeY + 70 + i * 48, { size: 38, weight: 600, color: C.text2 }));
  }
  ctx.restore();
  drawBurst(ctx, fx.burst, t - 0.35, W / 2, y + 230);
  drawConfetti(ctx, fx.confetti, t - 0.3);
}

function sceneSummary(ctx, t, winners, imgs, fx) {
  text(ctx, 'RESULTADO OFICIAL', W / 2, 560, { size: 46, weight: 800, color: C.gold, spacing: 6, alpha: clamp(t / 0.4) });
  const fs = fitText(ctx, '¡FELICITACIONES!', W - 160, 96);
  text(ctx, '¡FELICITACIONES!', W / 2, 680, { size: fs, weight: 900, family: 'Montserrat', alpha: clamp(t / 0.5) });
  const rowH = Math.min(190, 860 / Math.max(1, winners.length));
  winners.forEach((w, i) => {
    const a = easeOut((t - 0.3 - i * 0.15) / 0.5);
    if (a <= 0) return;
    const y = 780 + i * (rowH + 18) + (1 - a) * 30;
    ctx.save();
    ctx.globalAlpha = a;
    roundRect(ctx, 90, y, W - 180, rowH, 36);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = C.line;
    ctx.stroke();
    const cy = y + rowH / 2;
    // Con muchos ganadores el renglón es más bajo: todo se achica en proporción (con 8 se pisaban)
    const posSize = Math.round(Math.max(36, Math.min(60, rowH * 0.45)));
    const prizeSize = Math.round(Math.max(26, Math.min(42, rowH * 0.26)));
    text(ctx, `${w.position}°`, 170, cy + posSize * 0.36, { size: posSize, weight: 900, family: 'Montserrat', color: C.gold });
    const r = Math.min(62, rowH * 0.36);
    drawAvatar(ctx, imgs[i], w.userName, 300, cy, r);
    // El nombre completo: primero se achica la letra (hasta 36) y recién ahí se recorta
    const nameW = W - 90 - 390 - 40;
    let ns = Math.round(Math.max(30, Math.min(50, rowH * 0.3)));
    const minNs = Math.min(36, ns);
    ctx.font = `800 ${ns}px Inter, system-ui, sans-serif`;
    while (ctx.measureText(w.userName || 'Ganador/a').width > nameW && ns > minNs) { ns -= 2; ctx.font = `800 ${ns}px Inter, system-ui, sans-serif`; }
    const name = ellipsize(ctx, w.userName || 'Ganador/a', nameW);
    // Nombre arriba y premio abajo, centrados en el renglón
    const gap = Math.round(prizeSize * 0.25);
    const blockH = ns + gap + prizeSize;
    const top = cy - blockH / 2;
    text(ctx, name, 390, top + ns * 0.82, { size: ns, weight: 800, align: 'left' });
    text(ctx, String(w.prizeAmount || ''), 390, top + ns + gap + prizeSize * 0.82, { size: prizeSize, weight: 800, color: C.gold, align: 'left' });
    ctx.restore();
  });
  drawConfetti(ctx, fx.confetti, t);
}

function sceneOutro(ctx, t, logo) {
  const a = easeOut(t / 0.6);
  if (logo) {
    const s = 0.8 + 0.2 * easeBack(t / 0.7);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(W / 2, 800);
    ctx.scale(s, s);
    ctx.beginPath();
    ctx.arc(0, 0, 170, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(logo, -170, -170, 340, 340);
    ctx.restore();
  }
  const gs = fitText(ctx, '¡GRACIAS POR PARTICIPAR!', W - 160, 64);
  text(ctx, '¡GRACIAS POR PARTICIPAR!', W / 2, 1120, { size: gs, weight: 900, family: 'Montserrat', alpha: a });
  text(ctx, 'Seguí pidiendo por la app GO!', W / 2, 1210, { size: 44, weight: 600, color: C.text2, alpha: a });
  text(ctx, 'y sumá chances para el próximo sorteo', W / 2, 1270, { size: 44, weight: 600, color: C.text2, alpha: a });
  const b = easeOut((t - 0.5) / 0.5);
  roundRect(ctx, W / 2 - 300, 1380, 600, 110, 55);
  ctx.save();
  ctx.globalAlpha = b;
  ctx.fillStyle = C.red;
  ctx.fill();
  ctx.restore();
  text(ctx, 'GO! · MAGDALENA', W / 2, 1453, { size: 44, weight: 900, family: 'Montserrat', alpha: b, spacing: 3 });
}

// ---------------------------------------------------------------- render + grabación

/**
 * giveaway: el doc del sorteo (title, winners[], participantsAtDraw/totalParticipants, drawnAt).
 * onProgress(0..1). Devuelve { blob, mime, ext, durationMs }.
 */
export async function renderGiveawayVideo(giveaway, { onProgress } = {}) {
  const picked = pickVideoMime();
  if (!picked || !HTMLCanvasElement.prototype.captureStream) throw new Error('Este navegador no puede grabar video. Probá desde Chrome en la PC o en Android.');

  const winnersByPrize = [...(giveaway.winners || [])].sort((a, b) => a.position - b.position);
  if (!winnersByPrize.length) throw new Error('El sorteo no tiene ganadores');
  const showOrder = [...winnersByPrize].sort((a, b) => b.position - a.position); // del último premio al primero, como la página

  const drawnMs = giveaway.drawnAt?.toMillis?.() || (giveaway.drawnAt?.seconds ? giveaway.drawnAt.seconds * 1000 : Date.now());
  const data = {
    title: String(giveaway.title || 'Sorteo GO!').trim(),
    participants: Number(giveaway.participantsAtDraw ?? giveaway.totalParticipants ?? 0) || 0,
    date: new Date(drawnMs).toLocaleDateString('es-AR', { day: 'numeric', month: 'long', timeZone: 'America/Argentina/Buenos_Aires' }),
  };

  // Tipografías y fotos antes de empezar a grabar
  try { await Promise.all(['900 100px Montserrat', '800 50px Inter', '600 40px Inter'].map(f => document.fonts.load(f))); } catch (e) {}
  const [logo, ...avatarImgs] = await Promise.all([
    loadImage('/logo-pwa.png'),
    ...winnersByPrize.map(w => loadImage(w.photoURL)),
  ]);
  const imgByUser = new Map(winnersByPrize.map((w, i) => [w.userId || i, avatarImgs[i]]));
  const imgOf = (w, i) => imgByUser.get(w.userId || i) || null;

  // Línea de tiempo
  const scenes = [{ kind: 'intro', d: T_INTRO }, { kind: 'count', d: T_COUNT }];
  showOrder.forEach((w, i) => scenes.push({ kind: 'winner', d: i === showOrder.length - 1 ? T_LAST_WINNER : T_WINNER, w, seed: 101 + i }));
  scenes.push({ kind: 'summary', d: T_SUMMARY }, { kind: 'outro', d: T_OUTRO });
  let acc = 0;
  scenes.forEach(s => { s.start = acc; acc += s.d; });
  const total = acc;
  const fx = new Map(scenes.map((s, i) => [i, { confetti: makeConfetti(7 + i * 13, s.kind === 'summary' ? 70 : 34), burst: makeBurst(3 + i * 17, 60) }]));

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  // En el documento (algunos navegadores no graban un canvas suelto), fuera de la vista
  canvas.style.cssText = 'position:fixed; left:-99999px; top:0; width:108px; height:192px; pointer-events:none;';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  const draw = (t) => {
    background(ctx, t);
    header(ctx, logo);
    const i = scenes.findIndex(s => t >= s.start && t < s.start + s.d);
    const idx = i === -1 ? scenes.length - 1 : i;
    const s = scenes[idx];
    const lt = Math.min(t - s.start, s.d);
    // Fundido corto al cambiar de escena
    ctx.save();
    ctx.globalAlpha = (idx === 0 ? 1 : clamp(lt / 0.25)) * clamp((s.d - lt) / 0.25 + (idx === scenes.length - 1 ? 1 : 0));
    if (s.kind === 'intro') sceneIntro(ctx, lt, data);
    else if (s.kind === 'count') sceneCountdown(ctx, lt);
    else if (s.kind === 'winner') sceneWinner(ctx, lt, s.w, imgOf(s.w, winnersByPrize.indexOf(s.w)), fx.get(idx));
    else if (s.kind === 'summary') sceneSummary(ctx, lt, winnersByPrize, winnersByPrize.map(imgOf), fx.get(idx));
    else sceneOutro(ctx, lt, logo);
    ctx.restore();
  };

  draw(0);
  const stream = canvas.captureStream(FPS);
  const recorder = new MediaRecorder(stream, { mimeType: picked.mime, videoBitsPerSecond: 6_000_000 });
  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const stopped = new Promise((resolve, reject) => {
    recorder.onstop = resolve;
    recorder.onerror = (e) => reject(e?.error || new Error('No se pudo grabar el video'));
  });

  recorder.start(1000);
  const t0 = performance.now();
  await new Promise((resolve) => {
    // setTimeout además de rAF: si la pestaña queda de fondo rAF se frena del todo
    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      draw(Math.min(t, total));
      onProgress?.(clamp(t / total));
      if (t >= total + 0.3) return resolve();
      if (document.visibilityState === 'visible') requestAnimationFrame(tick);
      else setTimeout(tick, 1000 / FPS);
    };
    requestAnimationFrame(tick);
  });
  recorder.stop();
  await stopped;
  stream.getTracks().forEach(tr => tr.stop());
  canvas.remove();

  const blob = new Blob(chunks, { type: picked.mime.split(';')[0] });
  if (!blob.size) throw new Error('El video salió vacío');
  return { blob, mime: picked.mime.split(';')[0], ext: picked.ext, durationMs: Math.round(total * 1000) };
}
