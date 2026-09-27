// Piezas visuales del modo repartidor (oferta entrante y panel de pedidos en curso).
// Un solo lenguaje: el mapa manda, una acción principal por pantalla, el rojo GO solo para
// esa acción y el verde para "entregado". Cada tipo de pedido tiene su etiqueta y sus palabras.

export function driverTokens(isLight) {
  return isLight
    ? {
        sheet: '#FFFFFF', card: '#F3F4F6', line: '#E5E7EB', tx: '#0F172A', tx2: '#475569', tx3: '#64748B',
        brand: '#E11D48', brandTx: '#BE123C', green: '#047857', greenTx: '#047857', amberTx: '#B45309',
        amberBg: '#FEF3C7', greenBg: '#D1FAE5', shadow: '0 -12px 32px rgba(15,23,42,.12)', scrim: 'rgba(15,23,42,.35)',
        handle: '#CBD5E1',
      }
    : {
        sheet: '#14171C', card: '#1B1F26', line: '#262B33', tx: '#F3F4F6', tx2: '#A7AEB8', tx3: '#8A929D',
        brand: '#E11D48', brandTx: '#FB7185', green: '#047857', greenTx: '#34D399', amberTx: '#FBBF24',
        amberBg: 'rgba(245,158,11,.12)', greenBg: 'rgba(52,211,153,.12)', shadow: '0 -12px 32px rgba(0,0,0,.45)',
        scrim: 'rgba(0,0,0,.45)', handle: '#3A404A',
      };
}

const PATHS = {
  store: '<path d="M3 9l1.5-5h15L21 9"/><path d="M4 9v11h16V9"/><path d="M3 9h18"/><path d="M10 20v-5h4v5"/>',
  pin: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  package: '<path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5"/><path d="M12 13v8"/>',
  bag: '<path d="M6 8h12l1 13H5z"/><path d="M9 8a3 3 0 0 1 6 0"/>',
  person: '<circle cx="12" cy="7.5" r="3.5"/><path d="M5 21a7 7 0 0 1 14 0"/>',
  cash: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
  nav: '<path d="M3 11l18-8-8 18-2-8z"/>',
  shield: '<path d="M12 21s8-4 8-10V5l-8-3-8 3v6c0 6 8 10 8 10z"/>',
  chev: '<path d="M9 6l6 6-6 6"/>',
  chevUp: '<path d="M6 15l6-6 6 6"/>',
  chevDown: '<path d="M6 9l6 6 6-6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  check: '<path d="M5 12l5 5L20 7"/>',
  zap: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  swap: '<path d="M7 7h12l-3-3"/><path d="M17 17H5l3 3"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9"/><path d="M17 6l3 3"/>',
  note: '<path d="M5 4h14v16H5z"/><path d="M9 9h6"/><path d="M9 13h6"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 4.9.8c0 1.7-2.4 2.2-2.4 3.7"/><path d="M12 17h.01"/>',
  headset: '<path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1v-6h3zM3 19a2 2 0 0 0 2 2h1v-6H3z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18"/><path d="M8 3v4M16 3v4"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
};

export function dIcon(name, size = 20, color = 'currentColor', sw = 2) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0;display:block">${PATHS[name] || ''}</svg>`;
}

export const esc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const money = (n) => '$ ' + Math.round(Number(n) || 0).toLocaleString('es-AR');

/** Tipo de pedido → etiqueta y color (el color solo en la etiqueta, nunca en bloques grandes). */
export function orderKind(o = {}, extra = {}) {
  const favorType = String(o.favorType || extra.favorType || o.serviceType || extra.type || '').toLowerCase();
  if (o.isTrip || extra.isTrip || favorType === 'viaje') {
    const auto = (o.tripType || extra.tripType) === 'auto';
    return { key: 'viaje', label: auto ? 'GoViaje · auto' : 'GoViaje · moto', fg: '#38BDF8', fgLight: '#0369A1', bg: 'rgba(56,189,248,.14)', bgLight: '#E0F2FE' };
  }
  if (favorType === 'gocash' || o.isGoCash) return { key: 'gocash', label: 'Go Cash', fg: '#A78BFA', fgLight: '#6D28D9', bg: 'rgba(167,139,250,.16)', bgLight: '#EDE9FE' };
  if (['pagodeservicios', 'servicio', 'servicios'].includes(favorType) || o.isServicePayment) return { key: 'servicio', label: 'Pago de servicios', fg: '#FBBF24', fgLight: '#B45309', bg: 'rgba(245,158,11,.16)', bgLight: '#FEF3C7' };
  if (favorType === 'cadeteria') return { key: 'cadeteria', label: 'Cadetería', fg: '#A78BFA', fgLight: '#6D28D9', bg: 'rgba(167,139,250,.16)', bgLight: '#EDE9FE' };
  if (extra.isEncomienda) return { key: 'encomienda', label: 'Encomienda', fg: '#2DD4BF', fgLight: '#0F766E', bg: 'rgba(45,212,191,.14)', bgLight: '#CCFBF1' };
  if (o.isFavor || extra.isFavor) return { key: 'mandado', label: 'Mandado', fg: '#FBBF24', fgLight: '#B45309', bg: 'rgba(245,158,11,.16)', bgLight: '#FEF3C7' };
  return { key: 'comercio', label: 'Pedido de comercio', fg: '#FB7185', fgLight: '#BE123C', bg: 'rgba(225,29,72,.16)', bgLight: '#FFE4E6' };
}

export function kindTag(kind, isLight, label) {
  return `<span style="height:26px;padding:0 10px;border-radius:13px;background:${isLight ? kind.bgLight : kind.bg};color:${isLight ? kind.fgLight : kind.fg};font-size:12px;font-weight:700;letter-spacing:.02em;display:inline-flex;align-items:center;white-space:nowrap">${esc(label || kind.label)}</span>`;
}

/** Aro de cuenta regresiva (el número y el trazo los actualiza quien lo muestra). */
export const RING_C = 2 * Math.PI * 17;
export function countdownRing(secs, total, isLight, ids = {}) {
  const t = driverTokens(isLight);
  const off = RING_C * (1 - Math.max(0, Math.min(1, secs / total)));
  return `<div style="position:relative;width:44px;height:44px;flex-shrink:0" role="timer" aria-label="Segundos para responder">
    <svg width="44" height="44" viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="17" fill="none" stroke="${t.line}" stroke-width="4"/>
    <circle ${ids.ring ? `id="${ids.ring}"` : ''} cx="22" cy="22" r="17" fill="none" stroke="${t.brand}" stroke-width="4" stroke-linecap="round" stroke-dasharray="${RING_C.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 22 22)" style="transition:stroke-dashoffset 1s linear"/></svg>
    <span ${ids.num ? `id="${ids.num}"` : ''} style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-family:var(--font-display,'Outfit',sans-serif);font-size:15px;font-weight:700;color:${t.tx};font-variant-numeric:tabular-nums">${secs}</span>
  </div>`;
}

/**
 * Recorrido en orden, con los mismos números que el mapa: rojo = retirar, blanco = entregar,
 * tilde = hecho. La parada de ahora resaltada; las siguientes más tenues.
 * items: [{ kind: 'store'|'pkg'|'person'|'dest', title, sub, state: 'done'|'now'|'next', num?, tab?: { index, orderId } }]
 * Con `tab`, la fila es un botón (elegir esa parada).
 */
export function stopsList(items, isLight) {
  const t = driverTokens(isLight);
  let auto = 0;
  const n = items.length;
  return `<div style="display:flex;flex-direction:column;padding-left:4px">${items.map((s, i) => {
    const done = s.state === 'done';
    const now = s.state === 'now';
    const pickup = s.kind !== 'dest';
    const num = done ? null : (s.num != null ? s.num : ++auto);
    const badgeBg = done ? t.card : (pickup ? t.brand : (isLight ? '#0F172A' : '#F3F4F6'));
    const badgeFg = done ? t.tx3 : (pickup ? '#FFFFFF' : (isLight ? '#FFFFFF' : '#0C0F13'));
    const ring = now ? `box-shadow:0 0 0 3px ${t.sheet},0 0 0 5px ${pickup ? t.brand : (isLight ? '#0F172A' : '#F3F4F6')};` : '';
    const badge = `<span style="width:26px;height:26px;border-radius:13px;background:${badgeBg};color:${badgeFg};${done ? `border:1px solid ${t.line};box-sizing:border-box;` : ''}${ring}
      display:flex;align-items:center;justify-content:center;flex-shrink:0;font-family:var(--font-display,'Outfit',sans-serif);font-size:13px;font-weight:700">${done ? dIcon('check', 13, t.tx3, 3) : num}</span>`;
    const line = i < n - 1 ? `<span style="width:2px;flex-grow:1;min-height:10px;background:${t.line};margin:4px 0"></span>` : '';
    const titleColor = done ? t.tx3 : (now || s.state === undefined ? t.tx : t.tx2);
    const body = `<span style="display:flex;gap:12px;text-align:left">
      <span style="width:26px;display:flex;flex-direction:column;align-items:center;flex-shrink:0">${badge}${line}</span>
      <span style="flex:1;min-width:0;padding:3px 0 ${i < n - 1 ? 12 : 0}px">
        <span style="display:block;font-size:15px;font-weight:${now ? 700 : 600};color:${titleColor};${done ? 'text-decoration:line-through;' : ''}overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.title)}</span>
        ${s.sub ? `<span style="display:-webkit-box;font-size:13px;color:${t.tx3};margin-top:2px;line-height:1.35;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(s.sub)}</span>` : ''}
      </span>
    </span>`;
    return s.tab
      ? `<button class="dock-order-tab-btn" data-index="${s.tab.index}" data-order-id="${esc(s.tab.orderId)}" aria-label="Ver ${esc(s.title)}" style="display:block;width:100%;background:transparent;border:0;padding:0;cursor:pointer;font-family:inherit;color:inherit">${body}</button>`
      : `<div>${body}</div>`;
  }).join('')}</div>`;
}

/** Fila de plata: qué pasa con el dinero en este pedido (una sola, clara). */
export function moneyRow({ label, amount, sub = '', tone = 'amber', icon = 'cash', action = '' }, isLight) {
  const t = driverTokens(isLight);
  const map = {
    amber: [t.amberTx, t.amberBg],
    green: [t.greenTx, t.greenBg],
    violet: [isLight ? '#6D28D9' : '#A78BFA', isLight ? '#EDE9FE' : 'rgba(167,139,250,.14)'],
    neutral: [t.tx2, t.card],
  };
  const [fg, bg] = map[tone] || map.amber;
  return `<div style="display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:16px;background:${bg}">
    <span style="width:38px;height:38px;border-radius:12px;background:${isLight ? 'rgba(255,255,255,.7)' : 'rgba(0,0,0,.25)'};color:${fg};display:flex;align-items:center;justify-content:center;flex-shrink:0">${dIcon(icon, 19, fg)}</span>
    <div style="flex:1;min-width:0">
      <div style="font-size:13px;font-weight:600;color:${fg}">${esc(label)}</div>
      ${sub ? `<div style="font-size:12px;color:${t.tx2};margin-top:2px">${esc(sub)}</div>` : ''}
    </div>
    ${amount != null && amount !== '' ? `<div style="font-family:var(--font-display,'Outfit',sans-serif);font-size:21px;font-weight:700;color:${t.tx};white-space:nowrap">${esc(amount)}</div>` : ''}
    ${action}
  </div>`;
}

export function infoRow(icon, text, isLight, tone) {
  const t = driverTokens(isLight);
  const fg = tone === 'green' ? t.greenTx : tone === 'brand' ? t.brandTx : t.tx2;
  const bg = tone === 'green' ? t.greenBg : t.card;
  return `<div style="display:flex;align-items:center;gap:10px;padding:12px 14px;border-radius:14px;background:${bg};color:${fg};font-size:14px;font-weight:500;line-height:1.35">${dIcon(icon, 18, fg)}<span style="min-width:0">${esc(text)}</span></div>`;
}

export const isCashPayment = (o = {}) => {
  const pm = String(o.paymentMethod || '').toLowerCase();
  return pm === 'efectivo' || pm === 'cash' || pm.includes('efect');
};

/**
 * Go Cash: cuánto se cambia y en qué sentido.
 * transfer_to_cash: el cliente transfiere y el repartidor le lleva el efectivo.
 * cash_to_transfer: el cliente da efectivo y el repartidor le transfiere.
 * (Los pedidos viejos no guardaban el monto: se lee del detalle "por valor de $20.000".)
 */
export function goCashInfo(o = {}) {
  let amount = Number(o.goCashAmount ?? o.amount ?? o.cashAmount ?? 0);
  if (!(amount > 0)) {
    const m = String(o.details || o.description || '').match(/por valor de\s*\$\s*([\d.,]+)/i);
    if (m) amount = Number(m[1].replace(/\./g, '').replace(',', '.')) || 0;
  }
  const type = String(o.goCashType || o.paymentMethod || '').toLowerCase();
  const text = String(o.details || '').toLowerCase();
  const driverBringsCash = type === 'transfer_to_cash' || (type !== 'cash_to_transfer' && /transferencia a efectivo/.test(text));
  return { amount, driverBringsCash };
}

/** Distancia en km entre dos puntos {lat,lng} (o null). */
export function kmBetween(a, b) {
  const p = (c) => (c && !isNaN(Number(c.lat ?? c.latitude)) && !isNaN(Number(c.lng ?? c.longitude)) ? { lat: Number(c.lat ?? c.latitude), lng: Number(c.lng ?? c.longitude) } : null);
  const x = p(a), y = p(b);
  if (!x || !y) return null;
  const R = 6371, dLat = (y.lat - x.lat) * Math.PI / 180, dLng = (y.lng - x.lng) * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(x.lat * Math.PI / 180) * Math.cos(y.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h)) * 1.3; // calles, no línea recta
}
export const kmLabel = (km) => (km == null ? '' : (km < 1 ? `${Math.round(km * 1000 / 50) * 50} m` : `${km.toFixed(1).replace('.', ',')} km`));
export const pickupCoordsOf = (o = {}) => o.comercioCoordinates || o.comercioCoords || o.pickupCoords || o.pickupCoordinates || o.originCoords || o.originCoordinates || null;
export const dropoffCoordsOf = (o = {}) => o.deliveryCoords || o.deliveryCoordinates || o.destinationCoords || o.destinationCoordinates || o.addressCoords || o.shippingCoords || null;
