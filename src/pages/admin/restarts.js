// Admin → Reinicios: los reinicios de la app que anotó utils/reload-log.js, para saber si la app
// recargó sola (y por qué) o si el sistema la cerró.
import { db } from '../../firebase.js';
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const COLORS = { 'la app recargó': '#2563eb', 'reinicio sin aviso': '#dc2626', 'recarga manual': '#64748b' };

export function renderAdminRestarts(container) {
  container.innerHTML = `
    <div style="padding:16px; max-width:760px; margin:0 auto; font-family:Inter,system-ui,sans-serif;">
      <h2 style="margin:0 0 4px; font-size:20px; font-weight:800;">Reinicios de la app</h2>
      <p style="margin:0 0 14px; font-size:13px; color:var(--color-text-secondary);">
        <b style="color:#2563eb">La app recargó</b>: la pidió la app (dice el motivo).
        <b style="color:#dc2626">Reinicio sin aviso</b>: se cerró sola y volvió a abrir (en segundo plano casi siempre es el sistema liberando memoria).
        <b style="color:#64748b">Recarga manual</b>: botón Recargar, deslizar o el navegador.
      </p>
      <div id="restarts-list" style="display:flex; flex-direction:column; gap:8px;">Cargando…</div>
    </div>`;
  const list = container.querySelector('#restarts-list');
  const unsub = onSnapshot(query(collection(db, 'app_restarts'), orderBy('createdAt', 'desc'), limit(150)), (snap) => {
    if (snap.empty) { list.textContent = 'Todavía no hay reinicios registrados.'; return; }
    list.innerHTML = snap.docs.map((d) => {
      const r = d.data();
      const when = r.createdAt?.toDate ? r.createdAt.toDate().toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
      const color = COLORS[r.kind] || '#64748b';
      return `<div style="padding:10px 12px; border-radius:12px; background:var(--color-surface); border:1px solid var(--color-border-light); font-size:13px;">
        <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
          <b style="color:${color}">${esc(r.kind)}</b>
          <span>${esc(r.userName || r.uid)} · ${esc(r.role)}</span>
          <span style="margin-left:auto; color:var(--color-text-tertiary)">${esc(when)}</span>
        </div>
        <div style="margin-top:3px; color:var(--color-text-secondary)">${esc(r.reason)} · pantalla ${esc(r.route)} · ${esc(r.platform)}</div>
      </div>`;
    }).join('');
  }, (err) => { list.textContent = 'No se pudo cargar: ' + (err?.code || err); });
  return { cleanup: () => unsub() };
}
