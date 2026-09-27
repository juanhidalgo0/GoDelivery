// Seguimiento en vivo, vista del CLIENTE (la del repartidor sigue en order-tracking.js).
//
// Como las grandes apps (Uber Eats, Rappi, PedidosYa): una hoja abajo con
//   1. lo más importante grande: cuándo llega (o qué está pasando),
//   2. una barra de progreso de 4 pasos,
//   3. quién lo trae (con chat y llamada),
//   4. el código de entrega y cómo se paga,
//   5. el pedido, la dirección y las acciones (ver detalle, ayuda, cancelar).
// La hoja se achica tocando la manija para ver más mapa.
import { icon } from '../../utils/icons.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const money = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('es-AR');
const tsMs = (t) => (t && t.toMillis ? t.toMillis() : (t && t.seconds ? t.seconds * 1000 : (t ? new Date(t).getTime() || 0 : 0)));
const hhmm = (ms) => new Date(ms).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
const firstName = (s) => String(s || '').trim().split(/\s+/)[0] || '';

export function isTakeawayOrder(o) {
  return o.deliveryType === 'takeaway' || o.deliveryType === 'retiro';
}
function isEncomienda(o) {
  return o.favorType === 'encomienda' || o.serviceType === 'encomienda' || o.favorType === 'mandado' || o.isEncomienda === true;
}
function isGoCash(o) {
  return o.favorType === 'gocash' || o.isGoCash === true;
}
function isTransfer(o) {
  const pm = String(o.paymentMethod || '').toLowerCase();
  return pm === 'mercadopago' || pm.includes('transf');
}

/**
 * Qué mostrar según el tipo de pedido y el estado:
 * { tone, title, subtitle, eta (true si corresponde mostrar el tiempo), steps[4], active, done }
 */
export function trackingModel(o, status) {
  const driver = firstName(o.driverName) || (o.isTrip ? 'Tu chofer' : 'Tu repartidor');
  const store = o.comercioRealName || o.comercioName || 'el comercio';
  const hasDriver = Boolean(o.driverId);
  const m = { tone: 'live', title: '', subtitle: '', eta: false, steps: [], active: 0, done: false };

  if (status === 'cancelled') {
    return { ...m, tone: 'bad', title: o.isTrip ? 'Viaje cancelado' : 'Pedido cancelado', subtitle: o.cancelReason && o.cancelReason !== 'Cancelado por el cliente' ? o.cancelReason : (o.cancelledBy === 'client' ? 'Lo cancelaste vos.' : 'No se pudo completar.'), steps: [], active: -1 };
  }

  if (o.isTrip) {
    m.steps = ['Buscando chofer', 'En camino', 'En viaje', 'Llegaste'];
    if (status === 'completed') return { ...m, tone: 'ok', title: 'Llegaste a destino', subtitle: tripDoneText(o), active: 3, done: true };
    if (status === 'delivering') return { ...m, eta: true, title: 'En viaje', subtitle: `Destino: ${o.destinationAddress || o.deliveryAddress || ''}`, active: 2 };
    if (o.isAtDoor) return { ...m, tone: 'alert', title: `${driver} llegó`, subtitle: 'Te está esperando en el punto de encuentro.', active: 1 };
    if (hasDriver) return { ...m, eta: true, title: `${driver} va hacia vos`, subtitle: `Punto de encuentro: ${o.originAddress || o.pickupAddress || ''}`, active: 1 };
    return { ...m, tone: 'search', title: 'Buscando chofer', subtitle: 'Te avisamos apenas uno acepte el viaje.', active: 0 };
  }

  if (isTakeawayOrder(o)) {
    m.steps = ['Recibido', 'Preparando', 'Listo', 'Retirado'];
    if (status === 'completed') return { ...m, tone: 'ok', title: 'Pedido retirado', subtitle: '¡Que lo disfrutes!', active: 3, done: true };
    if (status === 'ready') return { ...m, tone: 'alert', title: 'Listo para retirar', subtitle: `Pasá por ${store}${o.comercioAddress ? ` · ${o.comercioAddress}` : ''}.`, active: 2 };
    if (status === 'preparing' || status === 'confirmed') return { ...m, title: 'Preparando tu pedido', subtitle: `${store} ya lo está preparando.`, active: 1 };
    return { ...m, tone: 'wait', title: 'Esperando confirmación', subtitle: `${store} está revisando tu pedido.`, active: 0 };
  }

  if (o.isFavor) {
    const enc = isEncomienda(o), cash = isGoCash(o);
    const verb = enc ? 'Retirando' : (cash ? 'Preparando' : 'Comprando');
    m.steps = ['Solicitado', verb, 'En camino', 'Entregado'];
    if (status === 'completed') return { ...m, tone: 'ok', title: enc ? 'Encomienda entregada' : (cash ? 'Go Cash completado' : 'Mandado entregado'), subtitle: doneText(o), active: 3, done: true };
    if (o.isAtDoor) return { ...m, tone: 'alert', title: `¡${driver} llegó!`, subtitle: 'Salí a recibirlo y tené a mano tu código.', active: 2 };
    if (status === 'delivering') return { ...m, eta: true, title: 'En camino', subtitle: enc ? `${driver} lleva tu encomienda.` : (cash ? `${driver} va hacia vos.` : `${driver} ya compró y va hacia vos.`), active: 2 };
    if (hasDriver) {
      const where = enc ? (o.pickupAddress || 'el punto de retiro') : String(o.pickupAddress || '').replace(/^Comercio:\s*/i, '');
      return { ...m, eta: true, title: enc ? `${driver} va a retirar` : (cash ? `${driver} va hacia vos` : `${driver} está comprando`), subtitle: cash ? 'Tené lista la transferencia o el efectivo.' : (where && !/^m[uú]ltiples/i.test(where) ? where : 'Te avisamos cuando salga hacia tu casa.'), active: 1 };
    }
    return { ...m, tone: 'search', title: 'Buscando repartidor', subtitle: 'Te avisamos apenas uno acepte.', active: 0 };
  }

  // Pedido a un comercio, con envío
  m.steps = ['Recibido', 'Preparando', 'En camino', 'Entregado'];
  if (status === 'completed') return { ...m, tone: 'ok', title: 'Pedido entregado', subtitle: doneText(o), active: 3, done: true };
  if (o.isAtDoor) return { ...m, tone: 'alert', title: `¡${driver} llegó!`, subtitle: 'Salí a recibirlo y tené a mano tu código.', active: 2 };
  if (status === 'delivering') return { ...m, eta: true, title: 'En camino', subtitle: `${driver} retiró tu pedido y va hacia vos.`, active: 2 };
  if (status === 'ready') {
    return hasDriver
      ? { ...m, eta: true, title: 'Listo para salir', subtitle: `${driver} va a buscarlo a ${store}.`, active: 1 }
      : { ...m, eta: true, tone: 'search', title: 'Buscando repartidor', subtitle: `Tu pedido ya está listo en ${store}.`, active: 1 };
  }
  if (status === 'preparing' || status === 'confirmed') return { ...m, eta: true, title: 'Preparando tu pedido', subtitle: hasDriver ? `${store} lo está preparando · ${driver} ya lo va a buscar.` : `${store} ya lo está preparando.`, active: 1 };
  return { ...m, tone: 'wait', title: 'Esperando confirmación', subtitle: `${store} está revisando tu pedido.`, active: 0 };
}

function doneText(o) {
  const at = tsMs(o.deliveredAt || o.completedAt);
  return at ? `Entregado a las ${hhmm(at)}. ¡Que lo disfrutes!` : '¡Que lo disfrutes!';
}
function tripDoneText(o) {
  const at = tsMs(o.completedAt || o.deliveredAt);
  return at ? `Llegaste a las ${hhmm(at)}. ¡Gracias por viajar con GO!` : '¡Gracias por viajar con GO!';
}

const TONES = {
  live: { fg: 'var(--gt-brand)', bg: 'var(--gt-brand-soft)' },
  wait: { fg: 'var(--gt-amber)', bg: 'var(--gt-amber-soft)' },
  search: { fg: 'var(--gt-brand)', bg: 'var(--gt-brand-soft)' },
  alert: { fg: 'var(--gt-amber)', bg: 'var(--gt-amber-soft)' },
  ok: { fg: 'var(--gt-green)', bg: 'var(--gt-green-soft)' },
  bad: { fg: 'var(--gt-red)', bg: 'var(--gt-red-soft)' },
};

function avatar(name, photo, size = 48) {
  const letter = esc((name || 'R').charAt(0).toUpperCase());
  const palette = ['#E11D48', '#2563EB', '#059669', '#D97706', '#7C3AED', '#0891B2'];
  const bg = palette[(name || '').length % palette.length];
  const inner = photo
    ? `<img src="${esc(photo)}" alt="" style="width:100%;height:100%;object-fit:cover" onerror="this.remove()">`
    : '';
  return `<div class="gt-avatar" style="width:${size}px;height:${size}px;background:${bg}"><span>${letter}</span>${inner}</div>`;
}

/** HTML de la hoja del cliente. flags: { canCancel, isDirectStore, collapsed } */
export function renderClientPanel(o, status, flags = {}) {
  const md = trackingModel(o, status);
  const tone = TONES[md.tone] || TONES.live;
  const final = status === 'completed' || status === 'cancelled';
  const total = Number(o.totalAmount || o.total || 0);
  const store = o.comercioRealName || o.comercioName || '';
  const hasDriver = Boolean(o.driverId);
  const phone = String(o.driverPhone || '').replace(/[^\d+]/g, '');
  // Llamar solo cuando ya viene hacia vos (el chat es el canal principal y cuida el número del repartidor)
  const canCall = Boolean(phone) && (status === 'delivering' || o.isAtDoor || (o.isTrip && hasDriver));

  // 1. Lo principal: cuándo llega / qué pasa
  const hero = `
    <div class="gt-hero">
      <div class="gt-hero-main">
        ${md.eta && !final ? `
          <div class="gt-eyebrow">${esc(md.title)}</div>
          <div class="gt-eta" id="gt-eta"><span class="gt-eta-val" id="gt-eta-val">Calculando…</span><span class="gt-eta-at" id="gt-eta-at"></span></div>
        ` : `
          <div class="gt-title" style="color:${md.tone === 'live' ? 'var(--gt-tx)' : tone.fg}">${md.tone === 'search' ? '<span class="gt-radar"></span>' : ''}${esc(md.title)}</div>
        `}
        <div class="gt-sub">${esc(md.subtitle)}</div>
      </div>
      ${md.tone === 'ok' ? `<div class="gt-hero-badge" style="background:${tone.bg};color:${tone.fg}">${icon('check', 22)}</div>` : ''}
      ${md.tone === 'bad' ? `<div class="gt-hero-badge" style="background:${tone.bg};color:${tone.fg}">${icon('close', 22)}</div>` : ''}
    </div>`;

  // 2. Progreso en 4 tramos (el actual avanza)
  const progress = md.steps.length ? `
    <div class="gt-progress" aria-label="Progreso: ${esc(md.steps[Math.max(0, md.active)] || '')}">
      ${md.steps.map((s, i) => `<div class="gt-seg ${i < md.active || md.done ? 'done' : ''} ${i === md.active && !md.done ? 'now' : ''}"><i></i></div>`).join('')}
    </div>
    <div class="gt-steps">${md.steps.map((s, i) => `<span class="${i === md.active ? 'on' : ''}">${esc(s)}</span>`).join('')}</div>` : '';

  // 3. Quién lo trae
  const driverCard = hasDriver && !final ? `
    <div class="gt-card gt-driver">
      ${avatar(o.driverName, o.driverPhoto)}
      <div class="gt-driver-info">
        <div class="gt-driver-name">${esc(o.driverName || (o.isTrip ? 'Tu chofer' : 'Tu repartidor'))}</div>
        <div class="gt-driver-meta">${esc(o.isTrip ? (o.tripType === 'auto' ? 'Chofer · Auto' : 'Chofer · Moto') : 'Repartidor de GO')}<span class="gt-live-dot" id="gt-live-dot" title="Ubicación en vivo"></span></div>
      </div>
      <div class="gt-driver-actions">
        ${canCall ? `<a class="gt-round" href="tel:${esc(phone)}" aria-label="Llamar a ${esc(o.driverName || 'tu repartidor')}">${icon('phone', 19)}</a>` : ''}
        <button class="gt-round gt-round-brand" id="header-chat-v5-btn" aria-label="Chatear">${icon('chatBubble', 19)}</button>
      </div>
    </div>` : (!hasDriver && !final && store && !o.isTrip && !o.isFavor ? `
    <div class="gt-card gt-driver">
      <div class="gt-avatar gt-logo" style="width:48px;height:48px"><img src="${esc(o.comercioRealLogo || o.comercioLogo || '/logo.png')}" alt="" onerror="this.src='/logo.png'"></div>
      <div class="gt-driver-info">
        <div class="gt-driver-name">${esc(store)}</div>
        <div class="gt-driver-meta">¿Una duda con tu pedido? Escribile</div>
      </div>
      <div class="gt-driver-actions"><button class="gt-round gt-round-brand" id="header-chat-v5-btn" aria-label="Chatear con el comercio">${icon('chatBubble', 19)}</button></div>
    </div>` : '');

  // 4. Código de entrega (lo pide el repartidor al entregar): una franja
  const showCode = !o.isTrip && !isTakeawayOrder(o) && !isEncomienda(o) && o.verificationCode && !final && (hasDriver || o.isFavor);
  const code = showCode ? `
    <div class="gt-code">
      <div class="gt-code-label">Código de entrega<span>Decíselo al recibir</span></div>
      <div class="gt-code-val" aria-label="Código ${esc(String(o.verificationCode).split('').join(' '))}">${esc(o.verificationCode)}</div>
    </div>` : '';

  // 5. Una sola fila: cuánto y cómo se paga, ver el pedido y ayuda (sin scroll: todo entra)
  let payText = '';
  if (o.isTrip) payText = isTransfer(o) ? 'Por transferencia al terminar' : 'En efectivo al terminar';
  else if (isTakeawayOrder(o)) payText = 'Retirás en el local';
  else if (isGoCash(o)) payText = 'Costo del servicio';
  else if (isTransfer(o)) payText = o.driverAlias ? `Transferencia a <b id="v5-driver-alias-val">${esc(o.driverAlias)}</b> <button class="gt-copy" id="v5-copy-alias-btn">Copiar</button>` : (hasDriver ? 'Transferencia · pedí el alias por chat' : 'Transferencia al recibir');
  else payText = o.cashChangeFor ? `Efectivo · cambio de ${money(o.cashChangeFor)}` : 'Efectivo al recibir';
  if (final) payText = status === 'completed' ? 'Total pagado' : 'Total del pedido';
  const foot = `
    <div class="gt-foot">
      <div class="gt-pay">
        <div class="gt-pay-top"><span id="v5-footer-total-val">${money(total)}</span></div>
        <div class="gt-pay-sub">${payText}</div>
      </div>
      <button class="gt-btn" id="v5-toggle-details-btn">${icon('receipt', 16)}Detalle y precios</button>
      <button class="gt-round gt-round-sm" id="gt-help-btn" aria-label="Ayuda">${icon('helpCircle', 18)}</button>
    </div>
    ${flags.canCancel ? `<button class="gt-cancel" id="v5-cancel-order-btn">${o.isTrip ? 'Cancelar viaje' : 'Cancelar pedido'}${o.pointsRedeemed > 0 ? ' · te devolvemos los Go Points' : ''}</button>` : ''}`;

  const viral = status === 'completed' && flags.isDirectStore ? `
    <div class="gt-card gt-viral">
      <div class="gt-row-title">¿Querés pedir en otros locales de Magdalena?</div>
      <div class="gt-row-sub">Decenas de comercios, ofertas y envío rápido en GoDelivery.</div>
      <button class="gt-cta" id="v5-viral-discovery-btn">Descubrí GoDelivery</button>
    </div>` : '';

  return `
    <div class="gt-sheet ${flags.collapsed ? 'collapsed' : ''}" id="gt-sheet">
      <button class="gt-handle" id="gt-handle" aria-label="${flags.collapsed ? 'Ver más' : 'Ver menos'}"><span></span></button>
      ${hero}
      ${progress}
      <div class="gt-more">
        ${driverCard}
        ${code}
        ${foot}
        ${viral}
      </div>
    </div>`;
}

/** Actualiza el tiempo estimado sin redibujar la hoja. */
export function setClientEta(minutesMin, minutesMax = null) {
  const val = document.getElementById('gt-eta-val');
  const at = document.getElementById('gt-eta-at');
  if (!val) return;
  const lo = Math.max(1, Math.round(minutesMin));
  const hi = minutesMax ? Math.max(lo, Math.round(minutesMax)) : null;
  val.textContent = hi && hi > lo ? `${lo}–${hi} min` : `${lo} min`;
  if (at) at.textContent = `Llega ${hhmm(Date.now() + (hi || lo) * 60000)} aprox.`;
}

export const CLIENT_PANEL_CSS = `
  .tracking-v5-viewport {
    --gt-bg: var(--color-surface, #fff); --gt-card: var(--color-bg-secondary, #F5F6F8); --gt-line: var(--color-border-light, #ECEEF1);
    --gt-tx: var(--color-text-primary, #0F172A); --gt-tx2: var(--color-text-secondary, #475569); --gt-tx3: var(--color-text-tertiary, #94A3B8);
    --gt-brand: #E11D48; --gt-brand-soft: rgba(225,29,72,.10);
    --gt-green: #059669; --gt-green-soft: rgba(5,150,105,.12);
    --gt-amber: #B45309; --gt-amber-soft: rgba(245,158,11,.16);
    --gt-red: #DC2626; --gt-red-soft: rgba(220,38,38,.10);
  }
  #tracking-info-panel.gt-client { left: 0; right: 0; bottom: 0; padding: 0; background: transparent; box-shadow: none; border: 0; border-radius: 0; backdrop-filter: none; -webkit-backdrop-filter: none; gap: 0; max-height: none; overflow: visible; animation: none; }
  .gt-sheet { background: var(--gt-bg); border-radius: 24px 24px 0 0; box-shadow: 0 -10px 30px rgba(15,23,42,.14); padding: 6px 18px calc(16px + max(var(--safe-area-inset-bottom, 0px), env(safe-area-inset-bottom, 0px)));
    overflow: hidden; font-family: 'Inter', system-ui, sans-serif; color: var(--gt-tx);
    animation: gtUp .35s cubic-bezier(.16,1,.3,1); }
  @keyframes gtUp { from { transform: translateY(24px); opacity: 0; } to { transform: none; opacity: 1; } }
  .gt-handle { display: block; width: 100%; height: 22px; border: 0; background: transparent; cursor: pointer; padding: 0; }
  .gt-handle span { display: block; width: 40px; height: 4px; border-radius: 2px; background: var(--gt-line); margin: 8px auto; }
  .gt-sheet.collapsed .gt-more { display: none; }
  .gt-hero { display: flex; align-items: flex-start; gap: 12px; padding: 0 0 12px; }
  .gt-hero-main { flex: 1; min-width: 0; }
  .gt-eyebrow { font-size: 13px; font-weight: 600; color: var(--gt-tx2); }
  .gt-eta { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-top: 2px; }
  .gt-eta-val { font-family: var(--font-display, 'Outfit', sans-serif); font-size: 32px; font-weight: 700; letter-spacing: -.02em; line-height: 1.1; }
  .gt-eta-at { font-size: 13px; color: var(--gt-tx3); font-weight: 500; }
  .gt-title { font-family: var(--font-display, 'Outfit', sans-serif); font-size: 24px; font-weight: 700; letter-spacing: -.01em; line-height: 1.2; display: flex; align-items: center; gap: 10px; }
  .gt-sub { font-size: 14.5px; color: var(--gt-tx2); margin-top: 4px; line-height: 1.4; }
  .gt-hero-badge { width: 44px; height: 44px; border-radius: 22px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .gt-radar { width: 12px; height: 12px; border-radius: 6px; background: var(--gt-brand); position: relative; flex-shrink: 0; }
  .gt-radar::after { content: ''; position: absolute; inset: -6px; border-radius: 50%; border: 2px solid var(--gt-brand); animation: gtRadar 1.6s ease-out infinite; }
  @keyframes gtRadar { from { transform: scale(.5); opacity: .9; } to { transform: scale(1.8); opacity: 0; } }
  .gt-progress { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
  .gt-seg { height: 5px; border-radius: 3px; background: var(--gt-line); overflow: hidden; position: relative; }
  .gt-seg i { position: absolute; inset: 0; width: 0; background: var(--gt-brand); border-radius: 3px; }
  .gt-seg.done i { width: 100%; }
  .gt-seg.now i { width: 100%; background: linear-gradient(90deg, rgba(225,29,72,.25) 0%, var(--gt-brand) 50%, rgba(225,29,72,.25) 100%); background-size: 200% 100%; animation: gtFlow 1.6s linear infinite; }
  @keyframes gtFlow { from { background-position: 100% 0; } to { background-position: -100% 0; } }
  .gt-steps { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-top: 6px; }
  .gt-steps span { font-size: 11.5px; color: var(--gt-tx3); font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .gt-steps span.on { color: var(--gt-tx); font-weight: 700; }
  .gt-more { display: flex; flex-direction: column; gap: 10px; margin-top: 14px; }
  .gt-card { background: var(--gt-card); border-radius: 18px; padding: 12px 14px; }
  .gt-driver { display: flex; align-items: center; gap: 12px; }
  .gt-avatar { border-radius: 50%; flex-shrink: 0; position: relative; overflow: hidden; display: flex; align-items: center; justify-content: center; color: #fff; font-weight: 700; font-size: 18px; }
  .gt-avatar img { position: absolute; inset: 0; }
  .gt-logo { background: #fff; border: 1px solid var(--gt-line); }
  .gt-logo img { width: 100%; height: 100%; object-fit: cover; position: static; }
  .gt-driver-info { flex: 1; min-width: 0; }
  .gt-driver-name { font-size: 16px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .gt-driver-meta { font-size: 13px; color: var(--gt-tx2); margin-top: 1px; display: flex; align-items: center; gap: 6px; }
  .gt-live-dot { width: 8px; height: 8px; border-radius: 4px; background: #10B981; box-shadow: 0 0 0 3px rgba(16,185,129,.18); }
  .gt-live-dot.stale { background: var(--gt-tx3); box-shadow: none; }
  .gt-driver-actions { display: flex; gap: 8px; flex-shrink: 0; }
  .gt-round { width: 44px; height: 44px; border-radius: 22px; border: 0; background: var(--gt-bg); color: var(--gt-tx); display: flex; align-items: center; justify-content: center; cursor: pointer; text-decoration: none; box-shadow: 0 1px 2px rgba(15,23,42,.08); }
  .gt-round-brand { background: var(--gt-brand); color: #fff; }
  .gt-code { display: flex; align-items: center; justify-content: space-between; gap: 12px; background: #0F172A; color: #fff; border-radius: 16px; padding: 10px 14px; }
  .gt-code-label { font-size: 14px; font-weight: 700; display: flex; flex-direction: column; }
  .gt-code-label span { font-size: 12px; font-weight: 500; color: rgba(255,255,255,.65); margin-top: 1px; }
  .gt-code-val { font-family: var(--font-display, 'Outfit', sans-serif); font-size: 26px; font-weight: 700; letter-spacing: .26em; color: #FB7185; margin-right: -.26em; }
  .gt-foot { display: flex; align-items: center; gap: 10px; padding-top: 2px; }
  .gt-pay { flex: 1; min-width: 0; }
  .gt-pay-top { display: flex; align-items: center; gap: 6px; font-family: var(--font-display, 'Outfit', sans-serif); font-size: 20px; font-weight: 700; }
  .gt-i { width: 28px; height: 28px; border-radius: 14px; border: 0; background: var(--gt-card); color: var(--gt-tx2); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; }
  .gt-pay-sub { font-size: 12.5px; color: var(--gt-tx2); margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .gt-pay-sub b { color: var(--gt-tx); font-weight: 700; }
  .gt-copy { border: 0; background: none; color: var(--gt-brand); font-weight: 700; font-size: 12.5px; cursor: pointer; padding: 0 0 0 4px; font-family: inherit; }
  .gt-btn { height: 44px; padding: 0 14px; border-radius: 22px; border: 1.5px solid var(--gt-line); background: var(--gt-bg); color: var(--gt-tx); font-weight: 700; font-size: 13.5px; cursor: pointer; flex-shrink: 0; font-family: inherit; display: inline-flex; align-items: center; gap: 6px; }
  .gt-btn svg { color: var(--gt-brand); }
  .gt-round-sm { width: 44px; height: 44px; background: var(--gt-card); box-shadow: none; flex-shrink: 0; }
  .gt-cancel { align-self: center; border: 0; background: none; color: var(--gt-red); font-weight: 600; font-size: 13.5px; cursor: pointer; padding: 4px 8px; font-family: inherit; }
  .gt-list { display: flex; flex-direction: column; border-radius: 18px; overflow: hidden; background: var(--gt-card); }
  .gt-list > * + * { border-top: 1px solid var(--gt-line); }
  .gt-row { display: flex; align-items: center; gap: 12px; padding: 12px 14px; width: 100%; box-sizing: border-box; background: transparent; border: 0; text-align: left; font-family: inherit; color: var(--gt-tx); }
  .gt-row-btn { cursor: pointer; }
  .gt-row-ic { width: 36px; height: 36px; border-radius: 12px; background: var(--gt-bg); color: var(--gt-tx2); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .gt-row-txt { flex: 1; min-width: 0; }
  .gt-row-title { font-size: 14.5px; font-weight: 600; line-height: 1.3; }
  .gt-row-sub { font-size: 13px; color: var(--gt-tx2); margin-top: 2px; line-height: 1.35; overflow-wrap: anywhere; }
  .gt-row-sub b { color: var(--gt-tx); font-weight: 700; }
  .gt-row-end { display: flex; align-items: center; gap: 4px; font-weight: 700; font-size: 15px; color: var(--gt-tx); flex-shrink: 0; }
  .gt-row-end svg { color: var(--gt-tx3); }
  .gt-chip { height: 34px; padding: 0 14px; border-radius: 17px; border: 0; background: var(--gt-brand); color: #fff; font-weight: 700; font-size: 13px; cursor: pointer; flex-shrink: 0; font-family: inherit; }
  .gt-actions { display: flex; gap: 6px; flex-wrap: wrap; }
  .gt-link { display: inline-flex; align-items: center; gap: 6px; height: 38px; padding: 0 12px; border-radius: 19px; border: 1px solid var(--gt-line); background: var(--gt-bg); color: var(--gt-tx2); font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; }
  .gt-link-danger { color: var(--gt-red); border-color: rgba(220,38,38,.25); margin-left: auto; }
  .gt-note { font-size: 12px; color: var(--gt-tx3); display: flex; align-items: center; gap: 5px; justify-content: flex-end; }
  .gt-viral { text-align: center; display: flex; flex-direction: column; gap: 8px; align-items: center; }
  .gt-cta { height: 44px; padding: 0 20px; border-radius: 22px; border: 0; background: var(--gt-brand); color: #fff; font-weight: 700; font-size: 14px; cursor: pointer; font-family: inherit; }
  .tracking-v5-viewport.gt-client-view #tracking-zoom-in-btn,
  .tracking-v5-viewport.gt-client-view #tracking-zoom-out-btn { display: none !important; }
  .tracking-v5-viewport.gt-client-view #v5-dynamic-eta-container { display: none !important; }
`;
