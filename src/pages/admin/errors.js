// Admin → Errores: la bandeja del vigilante. Junta tres orígenes en client_errors:
// - la app: lo que falló en los celulares (utils/error-reporter.js → functions/client-errors.js),
//   contado una vez por sesión ("40 veces" = 40 aperturas de la app donde pasó);
// - el servidor: errores de las Cloud Functions leídos de Cloud Logging (functions/vigilante.js);
// - la auditoría: revisiones de los datos cada 15 min (pedidos trabados, totales, cuentas…).
// Arriba, el estado de la última pasada del vigilante (system/vigilante) y "Revisar ahora".
import { db, auth } from '../../firebase.js';
import { collection, query, orderBy, limit, onSnapshot, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { showToast } from '../../components/toast.js';
import { functionUrl } from '../../utils/functions-url.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const KIND = {
  error: ['App · error sin atrapar', '#dc2626'],
  promesa: ['App · promesa rechazada', '#ea580c'],
  capturado: ['App · atrapado (console.error)', '#7c3aed'],
  toast: ['App · mensaje de error al usuario', '#db2777'],
  servidor: ['Servidor', '#0891b2'],
  auditoria: ['Auditoría de datos', '#2563eb'],
};
const TABS = [['open', 'Abiertos'], ['resolved', 'Resueltos'], ['ignored', 'Ignorados']];
const SOURCES = [['all', 'Todo'], ['app', 'App'], ['servidor', 'Servidor'], ['auditoria', 'Auditoría']];
const sourceOf = (e) => (e.kind === 'servidor' || e.kind === 'auditoria') ? e.kind : 'app';

function toDate(ts) { return ts?.toDate ? ts.toDate() : (ts ? new Date(ts) : null); }
function ago(ts) {
  const d = toDate(ts);
  if (!d || Number.isNaN(d.getTime())) return '';
  const m = Math.round((Date.now() - d.getTime()) / 60000);
  if (m < 1) return 'recién';
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  return d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// Los 3 valores más frecuentes de un mapa { valor: veces }
function top(map, n = 3) {
  return Object.entries(map || {}).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k} (${v})`).join(', ');
}

const pill = (text, fg, bg) => `<span style="font-size:11px; font-weight:800; color:${fg}; background:${bg}; padding:2px 8px; border-radius:8px;">${esc(text)}</span>`;

function card(e, focused) {
  const [kindLabel, kindColor] = KIND[e.kind] || KIND.error;
  const s = e.lastSample || {};
  const meta = (label, value) => value ? `<div><span style="color:var(--color-text-tertiary)">${label}:</span> ${esc(value)}</div>` : '';
  const btn = (status, label, bg, fg) => `<button class="err-status-btn" data-id="${esc(e.id)}" data-status="${status}" style="height:34px; padding:0 12px; border-radius:10px; border:1px solid var(--color-border-light); background:${bg}; color:${fg}; font-weight:700; font-size:12.5px; cursor:pointer;">${label}</button>`;
  const actions = e.status === 'open'
    ? btn('resolved', 'Marcar resuelto', '#16a34a', '#fff') + btn('ignored', 'Ignorar', 'transparent', 'var(--color-text-secondary)')
    : btn('open', 'Reabrir', 'transparent', 'var(--color-text-primary)');
  const isAudit = e.kind === 'auditoria';
  const isServer = e.kind === 'servidor';

  const summaryLine = isAudit
    ? `<b>${e.affected || 0}</b> ${e.affected === 1 ? 'caso' : 'casos'} ahora · detectado en <b>${e.count || 0}</b> ${e.count === 1 ? 'revisión' : 'revisiones'}`
    : isServer
      ? `<b>${e.count || 0}</b> ${e.count === 1 ? 'vez' : 'veces'} · función <b>${esc(s.service || e.frame || '?')}</b>`
      : `<b>${e.count || 0}</b> ${e.count === 1 ? 'vez' : 'veces'} · <b>${e.userCount || 0}</b> ${e.userCount === 1 ? 'persona' : 'personas'} · pantalla ${esc(s.route || '?')}`;

  let body;
  if (isAudit) {
    const items = Array.isArray(s.items) ? s.items : [];
    body = `
      ${s.help ? `<div style="padding:10px 12px; border-radius:10px; background:var(--color-bg-secondary); line-height:1.45;">${esc(s.help)}</div>` : ''}
      ${items.length ? `<div style="font-weight:700; color:var(--color-text-primary); margin-top:4px;">${e.status === 'open' ? 'Casos en la última revisión' : 'Casos la última vez que apareció'}:</div>
        <ul style="margin:0; padding-left:18px; display:flex; flex-direction:column; gap:3px;">${items.map((it) => `<li>${esc(it.label)}</li>`).join('')}</ul>
        ${(e.affected || 0) > items.length ? `<div style="color:var(--color-text-tertiary)">… y ${e.affected - items.length} más</div>` : ''}` : ''}
      ${meta('Primera vez', ago(e.firstSeen))}
      ${meta('Última revisión', ago(e.lastCheckedAt || e.lastSeen))}`;
  } else {
    body = `
      ${isServer ? '' : meta('Dónde saltó', e.frame)}
      ${isServer ? '' : meta('Pantallas', top(e.routes))}
      ${isServer ? '' : meta('Roles', top(e.roles))}
      ${isServer ? '' : meta('Versiones', top(e.versions))}
      ${isServer ? '' : meta('Dispositivos', top(e.platforms))}
      ${meta('Primera vez', ago(e.firstSeen))}
      ${isServer ? '' : meta('Última persona', [s.userName, s.role].filter(Boolean).join(' · '))}
      ${isServer ? '' : meta('Navegador', s.ua)}
      ${s.stack ? `<pre style="margin:6px 0 0; padding:10px; border-radius:10px; background:var(--color-bg-secondary); font-size:11px; line-height:1.4; white-space:pre-wrap; max-height:260px; overflow:auto;">${esc(s.stack)}</pre>` : ''}`;
  }

  return `<details id="err-${esc(e.id)}" ${focused ? 'open' : ''} style="padding:12px 14px; border-radius:14px; background:var(--color-surface); border:${focused ? '2px solid #dc2626' : '1px solid var(--color-border-light)'}; font-size:13px;">
    <summary style="cursor:pointer; list-style:none;">
      <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap; margin-bottom:4px;">
        ${pill(kindLabel, '#fff', kindColor)}
        ${isAudit && e.severity === 'media' ? pill('Aviso', '#64748b', 'rgba(100,116,139,.12)') : ''}
        ${e.network ? pill('Red o versión vieja', '#64748b', 'rgba(100,116,139,.12)') : ''}
        ${e.reopenCount ? pill(`Volvió ${e.reopenCount}×`, '#b45309', 'rgba(245,158,11,.15)') : ''}
        <span style="margin-left:auto; color:var(--color-text-tertiary); font-size:12px;">${esc(ago(e.lastSeen))}</span>
      </div>
      <div style="font-weight:700; color:var(--color-text-primary); word-break:break-word;">${esc(e.message)}</div>
      <div style="margin-top:4px; color:var(--color-text-secondary);">${summaryLine}</div>
    </summary>
    <div style="margin-top:10px; display:flex; flex-direction:column; gap:4px; color:var(--color-text-secondary); word-break:break-word;">
      ${body}
      ${e.statusBy ? meta(e.statusBy === 'vigilante' ? 'Resuelto solo' : 'Estado cambiado por', e.statusBy === 'vigilante' ? `${e.note || 'se normalizó'} ${ago(e.statusAt)}` : `${e.statusBy} ${ago(e.statusAt)}`) : ''}
      <div style="display:flex; gap:8px; margin-top:8px; flex-wrap:wrap;">${actions}</div>
    </div>
  </details>`;
}

function vigilantePanel(v) {
  if (!v) {
    return `<div style="padding:12px 14px; border-radius:14px; background:var(--color-bg-secondary); font-size:13px; color:var(--color-text-secondary);">El vigilante todavía no hizo su primera revisión (corre cada 15 minutos).</div>`;
  }
  const last = toDate(v.lastRunAt);
  const minutes = last ? (Date.now() - last.getTime()) / 60000 : Infinity;
  const late = minutes > 40;
  const checks = Object.entries(v.checks || {}).concat(Object.entries(v.dailyChecks || {}));
  const bad = checks.filter(([, c]) => c && c.ok === false);
  const failed = checks.filter(([, c]) => c && c.ok === null);
  const row = ([id, c]) => {
    const state = c.ok === true ? ['✓', '#16a34a'] : c.ok === false ? [`${c.affected}`, c.severity === 'media' ? '#b45309' : '#dc2626'] : ['falló', '#dc2626'];
    return `<div style="display:flex; gap:8px; align-items:center; justify-content:space-between; padding:3px 0;">
      <span style="min-width:0;">${esc(c.title || id)}</span>
      <b style="color:${state[1]}; flex-shrink:0;">${esc(state[0])}</b>
    </div>`;
  };
  const logs = v.logs || {};
  const logsLine = logs.error ? `<span style="color:#dc2626">no puede leer los registros del servidor</span>`
    : logs.skipped ? 'registros del servidor: no disponibles en el emulador'
    : `registros del servidor revisados (${logs.entries || 0} errores nuevos${logs.more ? ', sigue en la próxima' : ''})`;
  return `<details style="padding:12px 14px; border-radius:14px; background:var(--color-bg-secondary); border:1px solid ${late ? '#dc2626' : 'var(--color-border-light)'}; font-size:13px;">
    <summary style="cursor:pointer; list-style:none; display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
      <span style="font-size:18px;">${late ? '⛔' : (bad.length || failed.length ? '🩺' : '✅')}</span>
      <span style="flex:1; min-width:0; color:var(--color-text-primary);">
        <b>Vigilante</b> · última revisión ${esc(ago(v.lastRunAt)) || 'nunca'}${late ? ' (¡atrasado!)' : ''}<br>
        <span style="color:var(--color-text-secondary)">${checks.length} revisiones · ${bad.length ? `${bad.length} con casos` : 'todo en orden'}${failed.length ? ` · ${failed.length} fallaron` : ''} · ${logsLine}</span>
      </span>
      <button id="vigilante-run-btn" style="height:34px; padding:0 12px; border-radius:10px; border:0; background:var(--color-primary); color:#fff; font-weight:700; font-size:12.5px; cursor:pointer;">Revisar ahora</button>
    </summary>
    <div style="margin-top:10px; color:var(--color-text-secondary);">${checks.map(row).join('')}
      ${v.lastDailyAt ? `<div style="margin-top:6px; color:var(--color-text-tertiary)">Revisión completa y resumen diario: ${esc(ago(v.lastDailyAt))}</div>` : ''}
    </div>
  </details>`;
}

export function renderAdminErrors(container) {
  const focusId = new URLSearchParams((location.hash.split('?')[1] || '')).get('e');
  let tab = 'open';
  let source = 'all';
  let showNetwork = false;
  let all = [];
  let vigilante = null;
  let running = false;
  let statusOpen = false;

  container.innerHTML = `
    <div style="padding:16px; max-width:760px; margin:0 auto; font-family:Inter,system-ui,sans-serif;">
      <h2 style="margin:0 0 4px; font-size:20px; font-weight:800;">Errores y auditoría</h2>
      <p style="margin:0 0 12px; font-size:13px; color:var(--color-text-secondary); line-height:1.45;">
        Lo que falló en los celulares y en el servidor, y lo que el vigilante encontró en los datos.
        Te llega un aviso cuando aparece algo nuevo, cuando vuelve algo que estaba resuelto o cuando un error se repite mucho,
        y un resumen cada mañana. Los de <b>red</b> (sin conexión o con una versión vieja de la app) se anotan pero no avisan.
      </p>
      <div id="vigilante-status" style="margin-bottom:12px;"></div>
      <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center; margin-bottom:8px;">
        ${TABS.map(([k, l]) => `<button class="err-tab" data-tab="${k}" style="height:34px; padding:0 14px; border-radius:17px; border:1px solid var(--color-border-light); font-weight:700; font-size:13px; cursor:pointer;">${l} <span class="err-tab-n" data-tab="${k}"></span></button>`).join('')}
      </div>
      <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center; margin-bottom:12px;">
        ${SOURCES.map(([k, l]) => `<button class="err-source" data-source="${k}" style="height:30px; padding:0 12px; border-radius:15px; border:1px solid var(--color-border-light); font-weight:600; font-size:12.5px; cursor:pointer;">${l}</button>`).join('')}
        <label style="margin-left:auto; font-size:12.5px; color:var(--color-text-secondary); display:flex; gap:6px; align-items:center; cursor:pointer;">
          <input type="checkbox" id="err-show-network"> Ver errores de red
        </label>
      </div>
      <div id="errors-list" style="display:flex; flex-direction:column; gap:8px;">Cargando…</div>
    </div>`;

  const list = container.querySelector('#errors-list');
  const statusBox = container.querySelector('#vigilante-status');

  const renderStatus = () => {
    statusBox.innerHTML = vigilantePanel(vigilante);
    const details = statusBox.querySelector('details');
    if (details) {
      details.open = statusOpen;
      details.addEventListener('toggle', () => { statusOpen = details.open; });
    }
    const runBtn = statusBox.querySelector('#vigilante-run-btn');
    if (!runBtn) return;
    if (running) { runBtn.disabled = true; runBtn.textContent = 'Revisando…'; }
    runBtn.onclick = async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (running) return;
      running = true;
      renderStatus();
      try {
        const idToken = await auth.currentUser?.getIdToken();
        const res = await fetch(functionUrl('runVigilanteNow'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken, full: true }) });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(out.error || `HTTP ${res.status}`);
        showToast(out.problems ? `Revisión lista: ${out.problems} ${out.problems === 1 ? 'revisión con casos' : 'revisiones con casos'}` : 'Revisión lista: todo en orden', out.problems ? 'warning' : 'success');
      } catch (err) {
        showToast('No se pudo revisar: ' + (err?.message || err), 'error');
      } finally {
        running = false;
        renderStatus();
      }
    };
  };

  const render = () => {
    container.querySelectorAll('.err-tab').forEach((b) => {
      const on = b.dataset.tab === tab;
      b.style.background = on ? 'var(--color-primary)' : 'transparent';
      b.style.color = on ? '#fff' : 'var(--color-text-primary)';
    });
    container.querySelectorAll('.err-source').forEach((b) => {
      const on = b.dataset.source === source;
      b.style.background = on ? 'var(--color-text-primary)' : 'transparent';
      b.style.color = on ? 'var(--color-bg)' : 'var(--color-text-secondary)';
    });
    const visible = all.filter((e) => (showNetwork || !e.network) && (source === 'all' || sourceOf(e) === source));
    container.querySelectorAll('.err-tab-n').forEach((n) => {
      const c = visible.filter((e) => (e.status || 'open') === n.dataset.tab).length;
      n.textContent = c ? `(${c})` : '';
    });
    const rows = visible.filter((e) => (e.status || 'open') === tab);
    list.innerHTML = rows.length
      ? rows.map((e) => card(e, e.id === focusId)).join('')
      : `<div style="padding:24px; text-align:center; color:var(--color-text-tertiary); font-size:13.5px;">${tab === 'open' ? 'No hay nada abierto. 🎉' : 'Nada por acá.'}</div>`;
  };

  container.querySelectorAll('.err-tab').forEach((b) => { b.onclick = () => { tab = b.dataset.tab; render(); }; });
  container.querySelectorAll('.err-source').forEach((b) => { b.onclick = () => { source = b.dataset.source; render(); }; });
  container.querySelector('#err-show-network').onchange = (ev) => { showNetwork = ev.target.checked; render(); };

  list.addEventListener('click', async (ev) => {
    const b = ev.target.closest('.err-status-btn');
    if (!b) return;
    b.disabled = true;
    try {
      await updateDoc(doc(db, 'client_errors', b.dataset.id), {
        status: b.dataset.status,
        statusBy: auth.currentUser?.email || auth.currentUser?.uid || 'admin',
        statusAt: serverTimestamp(),
      });
      showToast(b.dataset.status === 'resolved' ? 'Marcado como resuelto: si vuelve a pasar, te avisa' : (b.dataset.status === 'ignored' ? 'Ignorado: no va a avisar más' : 'Reabierto'), 'success');
    } catch (err) {
      b.disabled = false;
      showToast('No se pudo cambiar: ' + (err?.code || err?.message || err), 'error');
    }
  });

  const unsubList = onSnapshot(query(collection(db, 'client_errors'), orderBy('lastSeen', 'desc'), limit(300)), (snap) => {
    all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const focused = focusId && all.find((e) => e.id === focusId);
    if (focused && list.dataset.focused !== '1') {
      tab = focused.status || 'open';
      if (focused.network) { showNetwork = true; container.querySelector('#err-show-network').checked = true; }
    }
    render();
    if (focused && list.dataset.focused !== '1') {
      list.dataset.focused = '1';
      container.querySelector(`#err-${CSS.escape(focusId)}`)?.scrollIntoView({ block: 'center' });
    }
  }, (err) => { list.textContent = 'No se pudo cargar: ' + (err?.code || err); });

  const unsubStatus = onSnapshot(doc(db, 'system', 'vigilante'), (snap) => {
    vigilante = snap.exists() ? snap.data() : null;
    renderStatus();
  }, () => { statusBox.innerHTML = ''; });
  renderStatus();
  // "hace X min" se actualiza solo
  const tick = setInterval(renderStatus, 60000);

  return { cleanup: () => { unsubList(); unsubStatus(); clearInterval(tick); } };
}
