// Dueño y personas con acceso a un comercio. La usan el admin (editor de comercios: puede
// cambiar el dueño) y el dueño (Local → Personas con acceso: suma y saca correos).
// Los cambios los hace el servidor (functions/commerce-access.js); acá solo se muestran.
import '../styles/commerce-panel.css';
import { db } from '../firebase.js';
import { doc, getDoc } from 'firebase/firestore';
import { getState } from '../state.js';
import { icon } from '../utils/icons.js';
import { escapeHtml as esc } from '../utils/escape.js';
import { showToast } from './toast.js';
import { comercioAccess } from '../utils/my-commerces.js';

const wrap = 'overflow-wrap:anywhere; word-break:break-word; min-width:0';

async function loadTeam(comercio) {
  const snap = await getDoc(doc(db, 'comercios', comercio.id, 'private', 'team')).catch(() => null);
  const t = snap && snap.exists() ? snap.data() : {};
  let ownerEmail = t.ownerEmail || '';
  let ownerName = '';
  // Comercios de antes de esta lista: el correo del dueño sale de su perfil
  if (comercio.ownerId) {
    try {
      const { getUserSummary } = await import('../utils/commerce-owner.js');
      const u = await getUserSummary(comercio.ownerId);
      if (u) { ownerName = u.name || ''; ownerEmail = ownerEmail || u.email || ''; }
    } catch (e) { /* sin permiso para ver el perfil: alcanza con el correo */ }
  }
  return { ownerEmail, ownerName, pendingOwnerEmail: t.pendingOwnerEmail || '', members: Array.isArray(t.members) ? t.members : [] };
}

/**
 * el: contenedor. comercio: { id, name, ownerId, ... }. asAdmin: muestra "cambiar dueño".
 * onChanged(): después de cada cambio (para refrescar la lista de comercios, por ejemplo).
 */
export function mountCommerceTeam(el, { comercio, asAdmin = false, onChanged } = {}) {
  const uid = getState().user?.uid;
  const canEdit = asAdmin || (comercio.ownerId && comercio.ownerId === uid);
  let team = null;
  let busy = false;

  const paint = () => {
    if (!team) { el.innerHTML = `<div class="cp-card"><span class="cp-muted">Cargando…</span></div>`; return; }
    const owner = comercio.ownerId
      ? `<div class="cp-strong" style="${wrap}">${esc(team.ownerName || team.ownerEmail || 'Dueño')}</div>
         ${team.ownerName && team.ownerEmail ? `<div class="cp-small" style="${wrap}">${esc(team.ownerEmail)}</div>` : ''}`
      : team.pendingOwnerEmail
        ? `<div class="cp-strong" style="${wrap}">${esc(team.pendingOwnerEmail)}</div>
           <div class="cp-small" style="color:#b45309">Todavía no entró a GO. Cuando entre con este correo queda como dueño.</div>`
        : `<div class="cp-strong" style="color:var(--go-red)">Sin dueño</div><div class="cp-small">Nadie puede entrar al panel de este comercio.</div>`;

    el.innerHTML = `
      <div class="cp-card" style="margin-bottom:12px">
        <div class="cp-label" style="margin-bottom:6px">Dueño</div>
        ${owner}
        ${asAdmin ? `
          <div class="cp-field" style="margin:12px 0 0">
            <label class="cp-label" for="team-owner-email">${comercio.ownerId || team.pendingOwnerEmail ? 'Cambiar el dueño por otro correo' : 'Correo del dueño'}</label>
            <input class="cp-input" id="team-owner-email" type="email" inputmode="email" autocomplete="off" placeholder="nombre@gmail.com" />
          </div>
          <button type="button" class="cp-btn is-ink is-block" data-act="owner" style="margin-top:8px">${icon('check', 18)} Guardar dueño</button>
          <div id="team-candidates"></div>` : ''}
      </div>
      <div class="cp-card">
        <div class="cp-label" style="margin-bottom:6px">Personas con acceso</div>
        <p class="cp-muted" style="margin:0 0 10px">Entran con su propia cuenta de Google y manejan el comercio igual que el dueño, sin que tengas que prestar la tuya. No pueden sumar a otras personas.</p>
        ${team.members.length ? `<div style="display:flex; flex-direction:column; gap:8px; margin-bottom:12px">
          ${team.members.map(m => `
            <div class="cp-row" style="align-items:flex-start; gap:10px; padding:10px 12px; border:1px solid var(--go-line, #e7e5e4); border-radius:14px">
              <span class="cp-grow" style="${wrap}">
                <span class="cp-strong" style="display:block; ${wrap}">${esc(m.email)}</span>
                <span class="cp-small" style="display:block; ${m.pending ? 'color:#b45309' : ''}">${m.pending ? 'Todavía no entró a GO: tiene acceso apenas entre con este correo' : 'Ya puede entrar'}</span>
              </span>
              ${canEdit || m.uid === uid ? `<button type="button" class="cp-btn is-ghost" data-act="remove" data-email="${esc(m.email)}" style="flex-shrink:0; min-height:40px; color:var(--go-red)">${m.uid === uid && !canEdit ? 'Salir' : 'Sacar'}</button>` : ''}
            </div>`).join('')}
        </div>` : `<p class="cp-small" style="margin:0 0 12px">Todavía no le diste acceso a nadie.</p>`}
        ${canEdit ? `
          <div class="cp-field" style="margin:0">
            <label class="cp-label" for="team-add-email">Dar acceso a un correo</label>
            <input class="cp-input" id="team-add-email" type="email" inputmode="email" autocomplete="off" placeholder="empleado@gmail.com" />
          </div>
          <button type="button" class="cp-btn is-ink is-block" data-act="add" style="margin-top:8px">${icon('plus', 18)} Dar acceso</button>` : ''}
        <p class="cp-small" id="team-err" style="color:var(--go-red); margin:10px 2px 0" hidden></p>
      </div>`;
    if (asAdmin) paintCandidates();
  };

  // Admin: quienes pidieron el alta con un nombre parecido (los dueños más probables)
  const paintCandidates = async () => {
    const box = el.querySelector('#team-candidates');
    if (!box || comercio.ownerId) return;
    const { findOwnerCandidates } = await import('../utils/commerce-owner.js');
    const list = (await findOwnerCandidates(comercio.name).catch(() => [])).filter(c => c.email);
    if (!list.length || !el.contains(box)) return;
    box.innerHTML = `<div class="cp-small" style="margin:12px 0 6px; font-weight:700">Pidieron el alta con un nombre parecido:</div>` + list.map(c => `
      <button type="button" class="cp-btn is-block" data-act="candidate" data-email="${esc(c.email)}" style="justify-content:space-between; text-align:left; margin-bottom:6px; height:auto; min-height:48px; padding:8px 12px">
        <span style="${wrap}"><b>${esc(c.name || c.email)}</b><br><span class="cp-small" style="${wrap}">${esc(c.email)} · pidió "${esc(c.applicationName)}"</span></span>
        <span style="flex-shrink:0; color:var(--go-green); font-weight:800">Asignar</span>
      </button>`).join('');
  };

  const showErr = (msg) => {
    const e = el.querySelector('#team-err');
    if (e) { e.textContent = msg; e.hidden = !msg; } else if (msg) showToast(msg, 'error');
  };

  const run = async (btn, fn) => {
    if (busy) return;
    busy = true;
    const old = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = 'Guardando…';
    showErr('');
    try {
      await fn();
      team = await loadTeam(comercio);
      paint();
      onChanged?.();
    } catch (err) {
      btn.disabled = false;
      btn.innerHTML = old;
      showErr(err.message || 'No se pudo guardar');
    } finally {
      busy = false;
    }
  };

  const setOwner = async (email) => {
    const r = await comercioAccess('setOwner', { comercioId: comercio.id, email });
    if (!r.pending) {
      // El servidor no devuelve el uid: se vuelve a leer el comercio
      const snap = await getDoc(doc(db, 'comercios', comercio.id));
      comercio.ownerId = snap.data()?.ownerId || '';
    } else comercio.ownerId = '';
    showToast(r.pending ? 'Listo: queda como dueño cuando entre a GO con ese correo' : 'Dueño asignado: ya puede entrar a su panel', 'success', 5000);
  };

  el.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act]');
    if (!t || !el.contains(t)) return;
    const act = t.dataset.act;
    if (act === 'owner') {
      const email = el.querySelector('#team-owner-email').value.trim();
      if (!email) { showErr('Escribí el correo del dueño'); return; }
      run(t, () => setOwner(email));
    } else if (act === 'candidate') {
      run(t, () => setOwner(t.dataset.email));
    } else if (act === 'add') {
      const email = el.querySelector('#team-add-email').value.trim();
      if (!email) { showErr('Escribí el correo de la persona'); return; }
      run(t, async () => {
        const r = await comercioAccess('addMember', { comercioId: comercio.id, email });
        showToast(r.pending ? 'Listo: va a tener acceso cuando entre a GO con ese correo' : 'Listo: ya puede entrar desde Mi comercio', 'success', 5000);
      });
    } else if (act === 'remove') {
      run(t, async () => {
        await comercioAccess('removeMember', { comercioId: comercio.id, email: t.dataset.email });
        showToast('Acceso quitado', 'info');
      });
    }
  });

  paint();
  loadTeam(comercio).then(t => { team = t; paint(); }).catch(() => { team = { ownerEmail: '', ownerName: '', pendingOwnerEmail: '', members: [] }; paint(); });
}
