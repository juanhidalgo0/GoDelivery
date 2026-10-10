// Pestaña Local: todo lo del negocio que se toca de vez en cuando, separado en bloques.
//   /settings            → menú de la pestaña (con "Primeros pasos" mientras falte algo)
//   /settings/datos      → Datos y fotos (settings.js)
//   /settings/horarios   → horario de cada día
//   /settings/seguridad  → PIN del panel
//   /settings/avanzado   → zona peligrosa
import { db } from '../../firebase.js';
import { doc, updateDoc, collection, getDocs, writeBatch } from 'firebase/firestore';
import { getRouteParams } from '../../router.js';
import { icon } from '../../utils/icons.js';
import { escapeHtml as esc } from '../../utils/escape.js';
import { showToast } from '../../components/toast.js';
import { DAY_NAMES, WEEK_ORDER, getWeeklySchedule, legacyFromWeekly, formatSlots } from '../../utils/commerce-hours.js';
import { getCommercePin, setCommercePin } from '../../utils/commerce-pin.js';
import { enterCommercePanel, getPanelComercio, onPanelComercio, cpSheet, cpConfirm, cpSkeleton, panelHref } from './shell.js';

export async function renderComercioLocal() {
  const { id: comercioId, section } = getRouteParams();
  if (!comercioId) return;
  if (section === 'datos') {
    const m = await import('./settings.js');
    return m.renderComercioSettings();
  }
  if (section === 'horarios') return renderHours(comercioId);
  if (section === 'seguridad') return renderSecurity(comercioId);
  if (section === 'avanzado') return renderDanger(comercioId);
  return renderHub(comercioId);
}

const back = (id) => `#/mi-comercio/${id}/settings`;

// ---------------------------------------------------------------- menú

async function renderHub(comercioId) {
  const body = await enterCommercePanel({ comercioId, tab: 'local' });
  if (!body) return;
  body.innerHTML = `<div class="cp-page" id="cp-local">${cpSkeleton(1, 110)}${cpSkeleton(1, 320)}</div>`;
  const root = body.querySelector('#cp-local');

  let productCount = null;
  let hasPin = null;
  getDocs(collection(db, 'comercios', comercioId, 'products')).then(s => { productCount = s.size; paint(); }).catch(() => {});
  getCommercePin(comercioId, getPanelComercio()).then(p => { hasPin = !!p; paint(); }).catch(() => {});

  const paint = () => {
    const c = getPanelComercio();
    if (!c) return;
    const weekly = getWeeklySchedule(c);
    const hasHours = Object.values(weekly).some(s => s.length);
    let shared = false;
    try { shared = localStorage.getItem(`gd-comercio-shared-${comercioId}`) === '1'; } catch (e) {}
    const steps = [
      { done: !!(c.logo && c.banner && c.coords), label: 'Logo, portada y dirección', href: `${back(comercioId)}/datos` },
      { done: hasHours, label: 'Tus horarios', href: `${back(comercioId)}/horarios` },
      { done: productCount === null ? true : productCount >= 5, label: 'Al menos 5 productos en el menú', href: panelHref(comercioId, 'menu') },
      { done: shared, label: 'Compartir tu link por WhatsApp', act: 'share' },
    ];
    const doneCount = steps.filter(s => s.done).length;
    const openDays = WEEK_ORDER.filter(d => weekly[d].length);
    const hoursSummary = !hasHours ? 'Sin horarios: la app te muestra cerrado'
      : openDays.length === 7 ? `Todos los días · ${formatSlots(weekly[1].length ? weekly[1] : weekly[openDays[0]])}`
      : `${openDays.length} días por semana · ${openDays.map(d => DAY_NAMES[d].slice(0, 3)).join(', ')}`;
    const item = (href, ic, title, sub, red = false, act = '') => `
      <${act ? 'button type="button"' : 'a'} class="cp-item" ${act ? `data-act="${act}"` : `href="${href}"`}>
        <span class="cp-item-icon ${red ? 'is-red' : ''}">${icon(ic, 20)}</span>
        <span class="cp-grow"><span class="cp-item-title" ${red ? 'style="color:var(--go-red)"' : ''}>${title}</span><span class="cp-item-sub" style="display:block">${sub}</span></span>
        <span class="cp-chev">${icon('chevronRight', 18)}</span>
      </${act ? 'button' : 'a'}>`;

    root.innerHTML = `
      ${doneCount < steps.length ? `
      <div class="cp-card">
        <div class="cp-row"><span class="cp-strong cp-grow">Primeros pasos</span><span class="cp-small">${doneCount} de ${steps.length}</span></div>
        <div class="cp-progress" style="margin:10px 0 6px"><i style="width:${(doneCount / steps.length) * 100}%"></i></div>
        ${steps.map(s => `
          <${s.done ? 'div' : (s.act ? 'button type="button"' : 'a')} class="cp-row" ${s.done ? '' : (s.act ? `data-act="${s.act}"` : `href="${s.href}"`)} style="padding:8px 0; width:100%; background:none; border:0; font:inherit; color:inherit; text-decoration:none; text-align:left; ${s.done ? '' : 'cursor:pointer'}">
            <span style="color:${s.done ? 'var(--go-green)' : 'var(--go-text-3)'}; display:flex">${icon(s.done ? 'checkCircle' : 'circle', 18)}</span>
            <span class="cp-grow" style="${s.done ? 'color:var(--go-text-3); text-decoration:line-through' : 'font-weight:600'}">${s.label}</span>
            ${s.done ? '' : `<span class="cp-chev">${icon('chevronRight', 16)}</span>`}
          </${s.done ? 'div' : (s.act ? 'button' : 'a')}>`).join('')}
      </div>` : ''}
      <div class="cp-list">
        ${item(`${back(comercioId)}/datos`, 'image', 'Datos y fotos', esc(c.address || 'Nombre, logo, portada y dirección'))}
        ${item(`${back(comercioId)}/horarios`, 'clock', 'Horarios', esc(hoursSummary))}
        ${item('', 'bike', 'Mis repartidores', 'Cadetes propios que pueden llevar tus pedidos', false, 'drivers')}
        ${item(`${back(comercioId)}/seguridad`, 'lock', 'Seguridad', hasPin === null ? 'PIN del panel' : hasPin ? 'PIN activado: se pide para entrar a la gestión' : 'Sin PIN: cualquiera con tu teléfono entra a la gestión')}
      </div>
      <div class="cp-list">
        ${item('', 'sparkles', 'Ver la guía del panel', 'Un recorrido de un minuto por cada parte', false, 'tour')}
        ${item('', 'headset', 'Soporte GO!', 'Escribinos por cualquier duda o problema', false, 'support')}
        ${item(`#/comercio/${comercioId}`, 'eye', 'Ver mi tienda', 'Como la ven tus clientes')}
      </div>
      <div class="cp-list">
        ${item(`${back(comercioId)}/avanzado`, 'alertTriangle', 'Zona peligrosa', 'Vaciar el menú o dar de baja el local', true)}
      </div>`;
  };

  root.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const act = t.dataset.act;
    if (act === 'share') {
      const { openWhatsAppCatalogModal } = await import('../../components/whatsapp-catalog-modal.js');
      await openWhatsAppCatalogModal(comercioId, getPanelComercio());
      paint();
    } else if (act === 'drivers') {
      const { showOwnDeliveriesModal } = await import('./orders.js');
      showOwnDeliveriesModal(comercioId);
    } else if (act === 'tour') {
      // Se recorre desde Pedidos, que es donde están los pasos de la cocina
      location.hash = panelHref(comercioId, 'orders');
      setTimeout(() => import('./tour.js').then(m => m.startCommerceTour()), 900);
    } else if (act === 'support') {
      const { openSupportTicketModal } = await import('../../components/support-bot.js');
      openSupportTicketModal(comercioId, `Comercio: ${getPanelComercio()?.name || ''}`);
    }
  });

  const stop = onPanelComercio(() => paint());
  return { cleanup: stop };
}

// ---------------------------------------------------------------- horarios

async function renderHours(comercioId) {
  const body = await enterCommercePanel({ comercioId, tab: 'local', sub: { title: 'Horarios', back: back(comercioId) } });
  if (!body) return;
  const weekly = getWeeklySchedule(getPanelComercio() || {});

  body.innerHTML = `
    <div class="cp-page" id="cp-hours">
      <p class="cp-muted" style="margin:0 2px 12px">Fuera de estos horarios la app muestra tu local cerrado y no se puede pedir. Si cerrás a la madrugada (por ejemplo de 20:00 a 01:00), cargalo así: la app entiende que termina al día siguiente.</p>
      <div class="cp-list" id="cp-days"></div>
      <button type="button" class="cp-btn is-block" data-act="copy" style="margin-bottom:10px">${icon('copy', 18)} Copiar el lunes a toda la semana</button>
      <p class="cp-small" id="cp-hours-err" style="color:var(--go-red); margin:0 2px 10px" hidden></p>
      <button type="button" class="cp-btn is-ink is-block" data-act="save">${icon('check', 18)} Guardar horarios</button>
    </div>`;
  const root = body.querySelector('#cp-hours');
  const days = root.querySelector('#cp-days');

  const paint = () => {
    days.innerHTML = WEEK_ORDER.map(d => {
      const slots = weekly[d];
      const open = slots.length > 0;
      return `
        <div class="cp-day">
          <div class="cp-day-name">${DAY_NAMES[d]}</div>
          <div class="cp-grow">
            ${open ? slots.map((s, i) => `
              <div class="cp-slot">
                <input class="cp-input" type="time" value="${esc(s.open)}" data-day="${d}" data-i="${i}" data-k="open" aria-label="${DAY_NAMES[d]}: abre" />
                <span class="cp-small">a</span>
                <input class="cp-input" type="time" value="${esc(s.close)}" data-day="${d}" data-i="${i}" data-k="close" aria-label="${DAY_NAMES[d]}: cierra" />
                <button type="button" class="cp-btn is-sm is-ghost" data-del="${d}:${i}" aria-label="Quitar turno" style="padding:0 8px">${icon('close', 16)}</button>
              </div>`).join('') + `<button type="button" class="cp-btn is-sm is-ghost" data-add="${d}" style="padding:0 4px">${icon('plus', 14)} Otro turno</button>`
            : `<div class="cp-muted" style="padding-top:10px">Cerrado</div>`}
          </div>
          <button type="button" class="cp-switch" role="switch" aria-label="Abre el ${DAY_NAMES[d].toLowerCase()}" aria-checked="${open}" data-toggle="${d}" style="margin-top:6px"></button>
        </div>`;
    }).join('');
  };
  paint();

  root.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.day === undefined) return;
    weekly[t.dataset.day][Number(t.dataset.i)][t.dataset.k] = t.value;
  });
  root.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-toggle],[data-add],[data-del],[data-act]');
    if (!t) return;
    const d = t.dataset;
    if (d.toggle !== undefined) {
      weekly[d.toggle] = weekly[d.toggle].length ? [] : [{ open: '09:00', close: '21:00' }];
      paint();
    } else if (d.add !== undefined) {
      const last = weekly[d.add][weekly[d.add].length - 1];
      weekly[d.add].push({ open: last?.close || '19:00', close: '23:00' });
      paint();
    } else if (d.del) {
      const [day, i] = d.del.split(':').map(Number);
      weekly[day].splice(i, 1);
      paint();
    } else if (d.act === 'copy') {
      for (let day = 0; day < 7; day++) if (day !== 1) weekly[day] = weekly[1].map(s => ({ ...s }));
      paint();
      showToast('Copiado. Revisá los días que son distintos y guardá.', 'info');
    } else if (d.act === 'save') {
      const err = root.querySelector('#cp-hours-err');
      const bad = WEEK_ORDER.find(day => weekly[day].some(s => !s.open || !s.close || s.open === s.close));
      if (bad !== undefined) {
        err.textContent = `Revisá el ${DAY_NAMES[bad].toLowerCase()}: cada turno necesita una hora de apertura y otra de cierre distintas.`;
        err.hidden = false;
        return;
      }
      err.hidden = true;
      const clean = {};
      for (let day = 0; day < 7; day++) clean[day] = weekly[day].map(s => ({ open: s.open, close: s.close }));
      const { daysOpen, schedules } = legacyFromWeekly(clean);
      t.disabled = true;
      try {
        // schedules/daysOpen quedan para versiones viejas de la app que todavía no leen weeklySchedule
        await updateDoc(doc(db, 'comercios', comercioId), { weeklySchedule: clean, daysOpen, schedules });
        showToast('Horarios guardados', 'success');
        location.hash = back(comercioId);
      } catch (e2) {
        console.error('Horarios:', e2);
        showToast('No se pudieron guardar. Probá de nuevo.', 'error');
      } finally {
        t.disabled = false;
      }
    }
  });
}

// ---------------------------------------------------------------- PIN

async function renderSecurity(comercioId) {
  const body = await enterCommercePanel({ comercioId, tab: 'local', sub: { title: 'Seguridad', back: back(comercioId) } });
  if (!body) return;
  body.innerHTML = `<div class="cp-page">${cpSkeleton(1, 200)}</div>`;
  const current = await getCommercePin(comercioId, getPanelComercio()).catch(() => '');

  body.innerHTML = `
    <div class="cp-page" id="cp-sec">
      <div class="cp-card">
        <div class="cp-row" style="margin-bottom:8px">
          <span class="cp-item-icon">${icon('lock', 20)}</span>
          <span class="cp-grow"><span class="cp-strong" style="display:block">PIN del panel</span><span class="cp-small">${current ? 'Activado' : 'Desactivado'}</span></span>
        </div>
        <p class="cp-muted" style="margin:0 0 12px">Sirve si un empleado usa el teléfono: puede atender <b>Pedidos</b> sin PIN, pero para entrar a Menú, Promos, Números y Local se lo pide. Después de 30 minutos sin usar la gestión, lo vuelve a pedir.</p>
        <div class="cp-field">
          <label class="cp-label" for="pin-new">${current ? 'PIN nuevo' : 'Elegí un PIN'} (4 números)</label>
          <input class="cp-input" id="pin-new" type="password" inputmode="numeric" maxlength="4" autocomplete="off" style="letter-spacing:10px; font-size:22px; text-align:center" />
        </div>
        <div class="cp-field">
          <label class="cp-label" for="pin-rep">Repetilo</label>
          <input class="cp-input" id="pin-rep" type="password" inputmode="numeric" maxlength="4" autocomplete="off" style="letter-spacing:10px; font-size:22px; text-align:center" />
        </div>
        <p class="cp-small" id="pin-err" style="color:var(--go-red); margin:0 2px 10px" hidden></p>
        <button type="button" class="cp-btn is-ink is-block" data-act="save">${icon('check', 18)} ${current ? 'Cambiar PIN' : 'Activar PIN'}</button>
        ${current ? `<button type="button" class="cp-btn is-ghost is-block" data-act="off" style="margin-top:6px; color:var(--go-red)">Quitar el PIN</button>` : ''}
      </div>
    </div>`;
  const root = body.querySelector('#cp-sec');
  root.querySelectorAll('input').forEach(i => i.addEventListener('input', () => { i.value = i.value.replace(/\D/g, ''); root.querySelector('#pin-err').hidden = true; }));
  root.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const err = root.querySelector('#pin-err');
    try {
      if (t.dataset.act === 'off') {
        if (!(await cpConfirm({ title: '¿Quitar el PIN?', message: 'Cualquiera que tenga tu teléfono va a poder entrar a toda la gestión del local.', confirmText: 'Quitar', danger: true }))) return;
        await setCommercePin(comercioId, '');
        showToast('PIN quitado', 'info');
        location.hash = back(comercioId);
        return;
      }
      const a = root.querySelector('#pin-new').value;
      const b = root.querySelector('#pin-rep').value;
      if (!/^\d{4}$/.test(a)) { err.textContent = 'El PIN tiene que tener 4 números.'; err.hidden = false; return; }
      if (a !== b) { err.textContent = 'Los dos PIN no coinciden.'; err.hidden = false; return; }
      await setCommercePin(comercioId, a);
      showToast(current ? 'PIN cambiado' : 'PIN activado', 'success');
      location.hash = back(comercioId);
    } catch (e2) {
      console.error('PIN:', e2);
      showToast('No se pudo guardar el PIN. Probá de nuevo.', 'error');
    }
  });
}

// ---------------------------------------------------------------- zona peligrosa

async function renderDanger(comercioId) {
  const body = await enterCommercePanel({ comercioId, tab: 'local', sub: { title: 'Zona peligrosa', back: back(comercioId) } });
  if (!body) return;
  body.innerHTML = `
    <div class="cp-page" id="cp-danger">
      <div class="cp-card is-danger">
        <div class="cp-strong">Vaciar el menú</div>
        <p class="cp-muted" style="margin:6px 0 12px">Borra todos tus productos. Sirve para volver a cargar el menú desde cero (por ejemplo desde Excel). No se puede deshacer.</p>
        <button type="button" class="cp-btn is-danger is-block" data-act="empty">${icon('trash', 18)} Vaciar el menú</button>
      </div>
      <div class="cp-card">
        <div class="cp-strong">Dar de baja el local</div>
        <p class="cp-muted" style="margin:6px 0 12px">Si solo querés dejar de recibir pedidos un tiempo, usá <b>Pausado</b> arriba o apagá "Visible en la app" en Datos y fotos. Para darte de baja del todo, escribinos.</p>
        <button type="button" class="cp-btn is-block" data-act="leave">${icon('headset', 18)} Pedir la baja a GO!</button>
      </div>
    </div>`;
  const root = body.querySelector('#cp-danger');
  root.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const name = getPanelComercio()?.name || '';
    if (t.dataset.act === 'leave') {
      const { openSupportTicketModal } = await import('../../components/support-bot.js');
      openSupportTicketModal(comercioId, `Baja del comercio: ${name}`);
      return;
    }
    // Escribir el nombre del local evita borrar todo por un toque sin querer
    let typed = '';
    const sheet = cpSheet({
      title: '¿Vaciar todo el menú?',
      sub: `Escribí "${name}" para confirmar. Se borran todos los productos.`,
      bodyHtml: `<input class="cp-input" id="cp-confirm-name" autocomplete="off" placeholder="${esc(name)}" />`,
      actions: [
        { label: 'Cancelar', cls: 'is-ghost' },
        { label: 'Vaciar', cls: 'is-red', onClick: async () => {
          if (typed.trim().toLowerCase() !== name.trim().toLowerCase()) { showToast('El nombre no coincide', 'warning'); return false; }
          try {
            const snap = await getDocs(collection(db, 'comercios', comercioId, 'products'));
            for (let i = 0; i < snap.docs.length; i += 400) {
              const batch = writeBatch(db);
              snap.docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
              await batch.commit();
            }
            showToast(`Menú vaciado: ${snap.size} productos borrados`, 'info');
          } catch (err) {
            console.error('Vaciar menú:', err);
            showToast('No se pudo vaciar el menú. Probá de nuevo.', 'error');
          }
        } },
      ],
    });
    sheet.el.querySelector('#cp-confirm-name').addEventListener('input', (ev) => { typed = ev.target.value; });
  });
}
