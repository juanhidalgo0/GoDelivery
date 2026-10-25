// Estructura del panel del comercio: encabezado con el estado del local, contenido y
// barra inferior de 5 pestañas. Vive sobre <body> (encima de la navegación de la app)
// y se mantiene montada mientras se navega entre pestañas del mismo comercio, así que
// cambiar de pestaña no parpadea. Cada pantalla pide su cuerpo con enterCommercePanel().
import '../../styles/commerce-panel.css';
import { db } from '../../firebase.js';
import { myCommercesQuery } from '../../utils/my-commerces.js';
import { doc, onSnapshot, updateDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { setState, getState } from '../../state.js';
import { isAdmin } from '../../auth.js';
import { icon } from '../../utils/icons.js';
import { escapeHtml } from '../../utils/escape.js';
import { showToast } from '../../components/toast.js';
import { isComercioOpenNow, scheduleStatusLine } from '../../utils/commerce-hours.js';
import { getCommercePin } from '../../utils/commerce-pin.js';
import { AudioManager } from '../../utils/audio-manager.js';

export const TABS = [
  { id: 'orders', label: 'Pedidos', icon: 'receipt', path: '/orders' },
  { id: 'menu', label: 'Menú', icon: 'restaurant', path: '/products' },
  { id: 'promos', label: 'Promos', icon: 'percent', path: '/promos' },
  { id: 'numbers', label: 'Números', icon: 'barChart', path: '' },
  { id: 'local', label: 'Local', icon: 'store', path: '/settings' },
];

export const panelHref = (comercioId, tab = 'orders', extra = '') =>
  `#/mi-comercio/${comercioId}${(TABS.find(t => t.id === tab) || TABS[0]).path}${extra}`;

// La gestión (todo menos Pedidos) queda desbloqueada 30 minutos desde el último uso
const UNLOCK_MS = 30 * 60 * 1000;
const unlockKey = (id) => `gd-comercio-unlock-${id}`;

let shell = null;          // { el, comercioId, data, unsubs, listeners }
let hashWatcher = null;

export function getPanelComercio() {
  return shell?.data || null;
}

// Avisa a quien lo pida cada vez que cambia el doc del comercio. Devuelve cómo dejar de escuchar.
export function onPanelComercio(cb) {
  if (!shell) return () => {};
  shell.listeners.add(cb);
  if (shell.data) cb(shell.data);
  return () => shell?.listeners.delete(cb);
}

function removeShell() {
  if (!shell) return;
  shell.unsubs.forEach(u => { try { u(); } catch (e) {} });
  shell.el.remove();
  document.querySelectorAll('.cp-sheet').forEach(s => s.remove());
  document.body.classList.remove('cp-open');
  shell = null;
}

function ensureHashWatcher() {
  if (hashWatcher) return;
  hashWatcher = () => {
    if (!shell) return;
    if (!location.hash.startsWith(`#/mi-comercio/${shell.comercioId}`)) removeShell();
  };
  window.addEventListener('hashchange', hashWatcher);
}

function mountShell(comercioId) {
  if (shell && shell.comercioId === comercioId) return shell;
  removeShell();

  const el = document.createElement('div');
  el.className = 'cp-shell';
  el.id = 'cp-shell';
  el.innerHTML = `
    <header class="cp-head">
      <a class="cp-head-btn" id="cp-back" hidden aria-label="Volver">${icon('chevronLeft', 22)}</a>
      <button class="cp-brand" id="cp-brand" type="button" aria-label="Opciones del local">
        <img class="cp-logo" id="cp-logo" src="/logo.png" alt="" onerror="this.onerror=null;this.src='/logo.png'" />
        <span class="cp-brand-text">
          <span class="cp-brand-name"><span class="cp-ellipsis" id="cp-name">Tu local</span><span id="cp-caret" style="display:flex;opacity:.7">${icon('chevronDown', 14)}</span></span>
          <span class="cp-brand-sub" id="cp-sub">Cargando…</span>
        </span>
      </button>
      <button class="cp-status" id="cp-status" type="button">Abierto</button>
    </header>
    <button class="cp-alarm" id="cp-alarm" type="button" hidden>${icon('bell', 18)} Hay pedidos sin aceptar <u>Silenciar</u></button>
    <button class="cp-alarm is-sound" id="cp-sound" type="button" hidden>${icon('volumeOff', 18)} El sonido de los pedidos está apagado <u>Activar</u></button>
    <button class="cp-alarm is-push" id="cp-push" type="button" hidden>${icon('bell', 18)} <span id="cp-push-text"></span> <u id="cp-push-act"></u></button>
    <main class="cp-body" id="cp-body"></main>
    <nav class="cp-nav" aria-label="Secciones del panel">
      ${TABS.map(t => `
        <a class="cp-tab" data-tab="${t.id}" href="${panelHref(comercioId, t.id)}">
          ${icon(t.icon, 22)}<span>${t.label}</span>
          ${t.id === 'orders' ? '<span class="cp-badge" id="cp-badge" hidden>0</span>' : ''}
        </a>`).join('')}
    </nav>`;
  document.body.appendChild(el);
  document.body.classList.add('cp-open');

  shell = { el, comercioId, data: null, unsubs: [], listeners: new Set(), sub: null, owned: [] };
  // "Mi comercio" vuelve al último comercio usado; y se averigua si el dueño tiene otros
  const uid = getState().user?.uid;
  if (uid) {
    // El admin entra a paneles ajenos desde Admin → Comercios: eso no cambia "su" comercio
    if (!isAdmin()) { try { localStorage.setItem(`gd_my_commerce_id_${uid}`, comercioId); } catch (e) {} }
    getDocs(myCommercesQuery(uid))
      .then(snap => { if (shell && shell.comercioId === comercioId) shell.owned = snap.docs.map(d => ({ id: d.id, ...d.data() })); })
      .catch(() => {});
  }
  ensureHashWatcher();

  el.querySelector('#cp-brand').addEventListener('click', () => openLocalMenu());
  const alarm = el.querySelector('#cp-alarm');
  alarm.hidden = !window.__commerceAlarmRinging;
  alarm.addEventListener('click', () => {
    alarm.hidden = true;
    window.dispatchEvent(new Event('mute-commerce-alarm'));
  });
  const onAlarm = (e) => { alarm.hidden = !e.detail?.ringing; };
  window.addEventListener('commerce-alarm', onAlarm);

  // En PC el navegador no deja sonar nada hasta el primer clic en la página: se avisa,
  // y cualquier clic (también en este botón) habilita la alarma
  const sound = el.querySelector('#cp-sound');
  const paintSound = () => { sound.hidden = !AudioManager.isAudioBlocked(); };
  const onGesture = () => setTimeout(paintSound, 0);
  paintSound();
  sound.addEventListener('click', () => {
    sound.hidden = true;
    showToast('Sonido activado: vas a escuchar los pedidos nuevos', 'success');
  });
  window.addEventListener('go-audio-blocked', paintSound);
  window.addEventListener('pointerdown', onGesture, true);
  window.addEventListener('keydown', onGesture, true);
  shell.unsubs.push(() => {
    window.removeEventListener('go-audio-blocked', paintSound);
    window.removeEventListener('pointerdown', onGesture, true);
    window.removeEventListener('keydown', onGesture, true);
  });
  setupPushStrip(el);
  el.querySelector('#cp-status').addEventListener('click', () => onStatusTap());

  shell.unsubs.push(onSnapshot(doc(db, 'comercios', comercioId), (snap) => {
    if (!shell) return;
    if (!snap.exists()) {
      // El comercio fue dado de baja (o el enlace es viejo): antes el panel quedaba en "Cargando…"
      // y pedidos y números fallaban con permission-denied (Admin → Errores, 11-10-2026)
      const uid = getState().user?.uid;
      try { if (uid && localStorage.getItem(`gd_my_commerce_id_${uid}`) === comercioId) localStorage.removeItem(`gd_my_commerce_id_${uid}`); } catch (e) {}
      const body = el.querySelector('#cp-body');
      if (body) body.innerHTML = cpEmpty('store', 'Este comercio ya no está disponible', 'Puede que lo hayan dado de baja. Si es un error, escribinos desde Soporte.', `<a class="cp-btn is-ink" href="#/">Ir al inicio</a>`);
      el.querySelector('#cp-sub').textContent = 'No disponible';
      return;
    }
    shell.data = { id: snap.id, ...snap.data() };
    setState('currentComercio', shell.data);
    paintHeader();
    shell.listeners.forEach(cb => { try { cb(shell.data); } catch (e) { console.error(e); } });
  }, (err) => console.warn('[Panel] comercio:', err?.code || err)));

  shell.unsubs.push(onSnapshot(
    query(collection(db, 'orders'), where('comercioId', '==', comercioId), where('status', '==', 'pending')),
    (snap) => {
      const badge = document.getElementById('cp-badge');
      if (!badge) return;
      badge.textContent = String(snap.size);
      badge.hidden = snap.size === 0;
    },
    (err) => console.warn('[Panel] pendientes:', err?.code || err)
  ));

  shell.unsubs.push(() => window.removeEventListener('commerce-alarm', onAlarm));

  // Mientras el panel está abierto, la hora del encabezado ("Cierra 23:30") se mantiene al día
  const tick = setInterval(paintHeader, 60 * 1000);
  shell.unsubs.push(() => clearInterval(tick));
  return shell;
}

function statusOf(c) {
  if (!c) return 'open';
  if (c.isPaused) return 'paused';
  return isComercioOpenNow(c) ? 'open' : 'closed';
}

function paintHeader() {
  if (!shell) return;
  const c = shell.data;
  const el = shell.el;
  const sub = shell.sub;
  const back = el.querySelector('#cp-back');
  const logo = el.querySelector('#cp-logo');

  back.hidden = !sub;
  if (sub) back.href = sub.back;
  logo.style.display = sub ? 'none' : '';
  el.querySelector('#cp-caret').style.display = sub ? 'none' : 'flex';

  if (c?.logo) logo.src = c.logo;
  el.querySelector('#cp-name').textContent = sub ? sub.title : (c?.name || 'Tu local');

  const st = statusOf(c);
  const btn = el.querySelector('#cp-status');
  btn.classList.toggle('is-paused', st === 'paused');
  btn.classList.toggle('is-closed', st === 'closed');
  btn.textContent = st === 'paused' ? 'Pausado' : st === 'closed' ? 'Cerrado' : 'Abierto';

  const line = st === 'paused' ? 'Pausado · no entran pedidos' : (c ? scheduleStatusLine(c) : 'Cargando…');
  el.querySelector('#cp-sub').textContent = sub ? `${c?.name || ''} · ${line}` : line;
}

function setActiveTab(tab, sub) {
  if (!shell) return;
  shell.sub = sub || null;
  shell.el.querySelectorAll('.cp-tab').forEach(a => {
    const on = a.dataset.tab === tab;
    a.classList.toggle('is-active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  paintHeader();
}

async function onStatusTap() {
  const c = shell?.data;
  if (!c) return;
  const id = shell.comercioId;
  const st = statusOf(c);
  if (st === 'paused') {
    await updateDoc(doc(db, 'comercios', id), { isPaused: false });
    showToast('Local abierto de nuevo: ya entran pedidos', 'success');
    return;
  }
  if (st === 'closed') {
    cpSheet({
      title: 'Estás fuera de horario',
      sub: `${scheduleStatusLine(c)}. Los clientes ven el local cerrado y no pueden pedir.`,
      actions: [
        { label: 'Cambiar horarios', cls: 'is-ink', onClick: () => { location.hash = `#/mi-comercio/${id}/settings/horarios`; } },
        { label: 'Entendido', cls: 'is-ghost' },
      ],
    });
    return;
  }
  const ok = await cpConfirm({
    title: '¿Pausar el local?',
    message: 'Mientras esté pausado no entran pedidos nuevos. Los que ya tenés siguen igual. Lo reanudás tocando el mismo botón.',
    confirmText: 'Pausar',
    danger: true,
  });
  if (!ok) return;
  await updateDoc(doc(db, 'comercios', id), { isPaused: true });
  showToast('Local pausado', 'info');
}

async function openLocalMenu() {
  if (!shell || shell.sub) return;
  const c = shell.data || {};
  const id = shell.comercioId;
  const hasUnlock = !!readUnlock(id);
  const item = (key, ic, title, subtitle, red = false) => `
    <button class="cp-item" data-k="${key}" type="button">
      <span class="cp-item-icon ${red ? 'is-red' : ''}">${icon(ic, 20)}</span>
      <span class="cp-grow"><span class="cp-item-title">${title}</span><span class="cp-item-sub" style="display:block">${subtitle}</span></span>
      <span class="cp-chev">${icon('chevronRight', 18)}</span>
    </button>`;
  const sheet = cpSheet({
    title: c.name || 'Tu local',
    bodyHtml: `<div class="cp-list">
      ${(shell.owned || []).length > 1 ? item('switch', 'store', 'Cambiar de comercio', `Tenés ${shell.owned.length} comercios`) : ''}
      ${item('store', 'eye', 'Ver mi tienda', 'Como la ven tus clientes')}
      ${item('share', 'whatsapp', 'Compartir mi catálogo', 'Link directo y código QR')}
      ${item('support', 'headset', 'Soporte GO!', 'Hablá con nosotros')}
      ${hasUnlock ? item('lock', 'lock', 'Bloquear el panel', 'Pide el PIN para volver a entrar') : ''}
      ${item('exit', 'home', 'Volver a la app', 'Salir del panel del comercio')}
    </div>`,
  });
  sheet.el.querySelectorAll('[data-k]').forEach(b => b.addEventListener('click', async () => {
    const k = b.dataset.k;
    sheet.close();
    if (k === 'store') location.hash = `#/comercio/${id}`;
    if (k === 'switch') renderCommercePicker(document.body, shell?.owned || [], id);
    if (k === 'exit') location.hash = '#/';
    if (k === 'lock') { clearUnlock(id); location.hash = panelHref(id, 'orders'); showToast('Panel bloqueado', 'info'); }
    if (k === 'share') {
      const { openWhatsAppCatalogModal } = await import('../../components/whatsapp-catalog-modal.js');
      openWhatsAppCatalogModal(id, shell?.data);
    }
    if (k === 'support') {
      try {
        const { openSupportTicketModal } = await import('../../components/support-bot.js');
        await openSupportTicketModal(id, `Comercio: ${c.name || ''}`);
      } catch (e) {
        showToast('No se pudo abrir el soporte. Probá de nuevo.', 'error');
      }
    }
  }));
}

// ---------------------------------------------------------------- PIN

function readUnlock(id) {
  try {
    const at = Number(sessionStorage.getItem(unlockKey(id)) || 0);
    return at && Date.now() - at < UNLOCK_MS ? at : 0;
  } catch (e) { return 0; }
}
function touchUnlock(id) { try { sessionStorage.setItem(unlockKey(id), String(Date.now())); } catch (e) {} }
function clearUnlock(id) { try { sessionStorage.removeItem(unlockKey(id)); } catch (e) {} }

async function passesPin(comercioId, body) {
  if (isAdmin() || readUnlock(comercioId)) { touchUnlock(comercioId); return true; }
  const pin = await getCommercePin(comercioId, shell?.data || null);
  if (!pin) return true;

  body.innerHTML = `
    <div class="cp-pin">
      <span class="cp-empty-icon" style="margin:0">${icon('lock', 28)}</span>
      <div style="text-align:center">
        <h2 class="cp-title" style="font-size:20px">Ingresá el PIN</h2>
        <p class="cp-muted" style="margin:6px 0 0">Para entrar a la gestión del local. Pedidos no lo pide.</p>
      </div>
      <div class="cp-pin-dots" id="cp-pin-dots"><i></i><i></i><i></i><i></i></div>
      <div class="cp-pin-pad">
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button class="cp-pin-key" data-v="${n}" type="button">${n}</button>`).join('')}
        <a class="cp-pin-key is-flat" href="${panelHref(comercioId, 'orders')}">Pedidos</a>
        <button class="cp-pin-key" data-v="0" type="button">0</button>
        <button class="cp-pin-key is-flat" data-v="del" type="button" aria-label="Borrar">${icon('arrowLeft', 22)}</button>
      </div>
    </div>`;

  let typed = '';
  const dots = body.querySelector('#cp-pin-dots');
  const paint = () => dots.querySelectorAll('i').forEach((d, i) => d.classList.toggle('is-on', i < typed.length));
  body.querySelectorAll('[data-v]').forEach(k => k.addEventListener('click', () => {
    const v = k.dataset.v;
    if (v === 'del') typed = typed.slice(0, -1);
    else if (typed.length < 4) typed += v;
    paint();
    if (typed.length < 4) return;
    if (typed === pin) {
      touchUnlock(comercioId);
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    } else {
      dots.classList.add('is-wrong');
      try { navigator.vibrate?.(120); } catch (e) {}
      setTimeout(() => { dots.classList.remove('is-wrong'); typed = ''; paint(); }, 380);
    }
  }));
  return false;
}

/**
 * Monta (o reutiliza) el panel y devuelve el cuerpo donde dibuja la pantalla.
 * Devuelve null si la pantalla quedó bloqueada esperando el PIN.
 * @param {{comercioId: string, tab: string, sub?: {title: string, back: string}, pin?: boolean}} o
 */
export async function enterCommercePanel({ comercioId, tab, sub = null, pin = true }) {
  mountShell(comercioId);
  setActiveTab(tab, sub);
  const body = shell.el.querySelector('#cp-body');
  body.scrollTop = 0;
  if (pin && !(await passesPin(comercioId, body))) return null;
  // Primera vez de un comercio en su panel: la guía, cuando la pantalla ya está dibujada
  if (tab === 'orders' && !sub) {
    import('./tour.js').then(m => {
      if (m.shouldShowCommerceTour()) setTimeout(() => m.startCommerceTour(), 900);
    }).catch(() => {});
  }
  return body;
}

// ---------------------------------------------------------------- hojas

// Avisos de pedidos nuevos en este dispositivo. Con el celular bloqueado la push es lo único que
// suena: el 10-10-2026 seis comercios no tenían ningún dispositivo registrado (nunca dieron el
// permiso o lo rechazaron) y sus pedidos entraban sin aviso. La franja dice qué falta y lo arregla.
const PUSH_STRIP = {
  prompt: { text: 'Activá los avisos de pedidos nuevos', act: 'Activar' },
  denied: { text: 'Los avisos de pedidos están bloqueados en este dispositivo', act: 'Cómo activarlos' },
  muted: { text: 'Los avisos de pedidos están silenciados en este celular', act: 'Cómo activarlos' },
  unsupported: { text: 'En este navegador no te llegan avisos de pedidos', act: 'Instalá la app' },
  error: { text: 'No pudimos registrar este dispositivo para los avisos', act: 'Reintentar' },
};

function setupPushStrip(el) {
  // El admin entra a paneles ajenos: su dispositivo no es el del comercio
  if (isAdmin()) return;
  const strip = el.querySelector('#cp-push');
  let status = null;
  const paint = (s) => {
    status = s;
    const info = PUSH_STRIP[s];
    strip.hidden = !info;
    if (!info) return;
    strip.querySelector('#cp-push-text').textContent = info.text;
    strip.querySelector('#cp-push-act').textContent = info.act;
  };
  const check = async (opts = {}) => {
    try {
      const { ensureCommercePushReady } = await import('../../utils/notifications.js');
      const s = await ensureCommercePushReady(opts);
      if (shell?.el === el) paint(s);
      return s;
    } catch (e) {
      console.warn('[Panel] avisos:', e);
      return null;
    }
  };

  strip.addEventListener('click', async () => {
    if (status === 'prompt' || status === 'error') {
      // En la web el pedido de permiso tiene que salir de un toque: por eso es un botón
      const s = await check({ ask: true });
      if (s === 'ok') showToast('Listo: te van a llegar los avisos de pedidos nuevos', 'success');
      else if (s === 'denied') showPushHelp('denied');
      else if (s === 'error') showToast('No se pudo registrar el dispositivo. Revisá la conexión y probá de nuevo.', 'error');
    } else if (status) {
      showPushHelp(status);
    }
  });

  check({ force: true });
  const onVisible = () => { if (document.visibilityState === 'visible') check({ force: true }); };
  document.addEventListener('visibilitychange', onVisible);
  const timer = setInterval(() => check({ force: true }), 10 * 60 * 1000);
  shell.unsubs.push(() => {
    document.removeEventListener('visibilitychange', onVisible);
    clearInterval(timer);
  });
}

function showPushHelp(status) {
  const platform = window.Capacitor?.getPlatform?.() || 'web';
  const ua = navigator.userAgent || '';
  const isIOS = platform === 'ios' || /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = platform === 'android' || /Android/.test(ua);
  const steps = (list) => `<ol class="cp-push-steps">${list.map(s => `<li>${s}</li>`).join('')}</ol>`;

  if (status === 'unsupported') {
    cpSheet({
      title: 'Recibí los avisos de pedidos',
      sub: isIOS
        ? 'En el iPhone, Safari no muestra avisos de esta página. Con la app de GO! te suenan los pedidos aunque tengas el celular bloqueado.'
        : 'Este navegador no recibe avisos. Con la app de GO! te suenan los pedidos aunque tengas el celular bloqueado.',
      actions: [
        { label: isIOS ? 'Abrir App Store' : 'Abrir Play Store', cls: 'is-ink', onClick: async () => {
          const { APP_STORE_URL, PLAY_STORE_URL } = await import('../../components/install-prompt.js');
          window.open(isIOS ? APP_STORE_URL : PLAY_STORE_URL, '_blank');
        } },
        { label: 'Ahora no' },
      ],
    });
    return;
  }

  let body;
  if (platform === 'android') {
    body = status === 'muted'
      ? steps(['Abrí <b>Ajustes</b> del celular → <b>Apps</b> → <b>GO!</b> → <b>Notificaciones</b>.', 'Activá <b>Pedidos nuevos</b> (y dejalo con sonido).', 'Volvé a la app.'])
      : steps(['Abrí <b>Ajustes</b> del celular → <b>Apps</b> → <b>GO!</b>.', 'Entrá a <b>Notificaciones</b> y activá <b>Permitir notificaciones</b>.', 'Volvé a la app: esta franja desaparece sola.']);
  } else if (platform === 'ios') {
    body = steps(['Abrí <b>Ajustes</b> del iPhone → <b>Notificaciones</b> → <b>GO!</b>.', 'Activá <b>Permitir notificaciones</b>, <b>Sonidos</b> y <b>Pantalla bloqueada</b>.', 'Volvé a la app: esta franja desaparece sola.']);
  } else if (isIOS) {
    body = steps(['Abrí <b>Ajustes</b> del iPhone → <b>Notificaciones</b> → <b>GO!</b> (la app que agregaste a la pantalla de inicio).', 'Activá <b>Permitir notificaciones</b>.', 'Volvé a la app.']);
  } else if (isAndroid) {
    body = steps(['Tocá el candado <b>🔒</b> al lado de la dirección, arriba.', 'Entrá a <b>Permisos</b> → <b>Notificaciones</b> → <b>Permitir</b>.', 'Recargá la página.']);
  } else {
    body = steps(['Hacé clic en el ícono <b>🔒</b> a la izquierda de la dirección, arriba.', 'En <b>Notificaciones</b> elegí <b>Permitir</b>.', 'Recargá la página. Dejá esta pestaña abierta mientras atendés.']);
  }
  cpSheet({
    title: 'Activá los avisos de pedidos',
    sub: 'Sin esto, si no estás mirando la pantalla, los pedidos nuevos entran sin sonar.',
    bodyHtml: body,
    actions: [{ label: 'Entendido', cls: 'is-ink' }],
  });
}

/**
 * Hoja que sube desde abajo, con el estilo del panel.
 * actions: [{ label, cls, onClick }] — onClick puede devolver false para no cerrar.
 */
export function cpSheet({ title = '', sub = '', bodyHtml = '', actions = [], dismissible = true, onClose = null } = {}) {
  const el = document.createElement('div');
  el.className = 'cp-sheet';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', title);
  el.innerHTML = `
    <div class="cp-sheet-backdrop" ${dismissible ? 'data-close' : ''}></div>
    <div class="cp-sheet-card">
      <span class="cp-sheet-handle"></span>
      ${title ? `<h2 class="cp-sheet-title">${escapeHtml(title)}</h2>` : ''}
      ${sub ? `<p class="cp-sheet-sub">${escapeHtml(sub)}</p>` : ''}
      ${bodyHtml}
      ${actions.length ? `<div class="cp-actions" style="margin-top:14px; flex-direction:${actions.length > 2 ? 'column' : 'row'}">
        ${actions.map((a, i) => `<button type="button" class="cp-btn ${a.cls || ''}" data-act="${i}">${escapeHtml(a.label)}</button>`).join('')}
      </div>` : ''}
    </div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('is-open')));

  let closed = false;
  const close = (reason = 'dismiss') => {
    if (closed) return;
    closed = true;
    el.classList.remove('is-open');
    setTimeout(() => el.remove(), 260);
    document.removeEventListener('keydown', onKey);
    if (onClose) onClose(reason);
  };
  const onKey = (e) => { if (e.key === 'Escape' && dismissible) close(); };
  document.addEventListener('keydown', onKey);
  el.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => close()));
  el.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', async () => {
    const a = actions[Number(b.dataset.act)];
    const keep = a.onClick ? await a.onClick(el) : undefined;
    if (keep !== false) close('action');
  }));
  return { el, close };
}

export function cpConfirm({ title, message = '', confirmText = 'Confirmar', cancelText = 'Cancelar', danger = false }) {
  return new Promise((resolve) => {
    let answered = false;
    cpSheet({
      title,
      sub: message,
      actions: [
        { label: cancelText, cls: 'is-ghost', onClick: () => { answered = true; resolve(false); } },
        { label: confirmText, cls: danger ? 'is-red' : 'is-ink', onClick: () => { answered = true; resolve(true); } },
      ],
      onClose: () => { if (!answered) resolve(false); },
    });
  });
}

// Estados vacíos y cargas, iguales en todas las pestañas
export const cpEmpty = (ic, title, text = '', actionHtml = '') => `
  <div class="cp-empty">
    <div class="cp-empty-icon">${icon(ic, 28)}</div>
    <div class="cp-empty-title">${title}</div>
    ${text ? `<div class="cp-muted">${text}</div>` : ''}
    ${actionHtml ? `<div style="margin-top:16px">${actionHtml}</div>` : ''}
  </div>`;

export const cpSkeleton = (n = 3, h = 110) =>
  Array.from({ length: n }, () => `<div class="cp-skel" style="height:${h}px; margin-bottom:10px"></div>`).join('');

// ---------------------------------------------------------------- varios comercios

/**
 * Pantalla para elegir comercio cuando el dueño tiene más de uno. Se usa al entrar a
 * "Mi comercio" (sin uno recordado) y desde "Cambiar de comercio" en el menú del logo.
 */
export function renderCommercePicker(_container, list, currentId = null) {
  document.getElementById('cp-picker')?.remove();
  const el = document.createElement('div');
  el.id = 'cp-picker';
  el.className = 'cp-sheet is-open';
  el.innerHTML = `
    <div class="cp-sheet-backdrop" ${currentId ? 'data-close' : ''}></div>
    <div class="cp-sheet-card">
      <span class="cp-sheet-handle"></span>
      <h2 class="cp-sheet-title">¿A qué comercio entrás?</h2>
      <p class="cp-sheet-sub">Tenés ${list.length} comercios. Después podés cambiar tocando el logo.</p>
      <div class="cp-list">
        ${list.map(c => `
          <button class="cp-item" type="button" data-go="${escapeHtml(c.id)}">
            <img class="cp-logo" src="${escapeHtml(c.logo || '/logo.png')}" alt="" onerror="this.onerror=null;this.src='/logo.png'" style="width:44px;height:44px" />
            <span class="cp-grow">
              <span class="cp-item-title">${escapeHtml(c.name || 'Comercio')}</span>
              <span class="cp-item-sub" style="display:block">${escapeHtml(c.address || c.category || '')}${c.approvedByAdmin === false ? ' · pendiente de aprobación' : ''}</span>
            </span>
            ${c.id === currentId ? '<span class="cp-tag is-green">Abierto ahora</span>' : `<span class="cp-chev">${icon('chevronRight', 18)}</span>`}
          </button>`).join('')}
      </div>
      ${currentId ? '<button type="button" class="cp-btn is-ghost is-block" data-close>Cancelar</button>' : '<button type="button" class="cp-btn is-ghost is-block" data-home>Volver a la app</button>'}
    </div>`;
  document.body.appendChild(el);
  const close = () => el.remove();
  el.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
  el.querySelector('[data-home]')?.addEventListener('click', () => { close(); location.hash = '#/'; });
  el.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => {
    close();
    const id = b.dataset.go;
    if (id === currentId) return;
    const uid = getState().user?.uid;
    if (uid) { try { localStorage.setItem(`gd_my_commerce_id_${uid}`, id); } catch (e) {} }
    location.hash = `#/mi-comercio/${id}/orders`;
  }));
  // Si se navega a otro lado sin elegir, no queda colgada
  const onHash = () => { if (!location.hash.startsWith('#/mi-comercio')) { close(); window.removeEventListener('hashchange', onHash); } };
  window.addEventListener('hashchange', onHash);
}
