import { db, auth } from '../../firebase.js';
import { collection, doc, getDoc, getDocs, setDoc, addDoc, deleteDoc, updateDoc, onSnapshot, query, where, orderBy, limit, serverTimestamp, Timestamp } from 'firebase/firestore';
import { icon } from '../../utils/icons.js';
import { showToast } from '../../components/toast.js';
import { isAdmin } from '../../auth.js';

// --- Utility Functions ---

// Nombres, títulos y premios salen de Firestore (los nombres, de la cuenta de
// cada participante): nunca van crudos a innerHTML.
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Premios en Puntos GO: el admin carga pesos y el punto vale
// settings/global.dollarPerPoint pesos (lo mismo que usa el carrito al canjear).
const fmtNum = (n) => Math.round(Number(n) || 0).toLocaleString('es-AR');
// El punto puede valer centavos ($0,10): no redondear.
const fmtRate = (n) => Number(n).toLocaleString('es-AR', { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 });

function prizePesos(p) {
  if (Number(p?.pesosValue) > 0) return Math.round(Number(p.pesosValue));
  const digits = String(p?.amount || '').replace(/[^\d]/g, '');
  return digits ? parseInt(digits, 10) : 0;
}

function pointsFor(pesos, dollarPerPoint) {
  return pesos > 0 ? Math.round(pesos / dollarPerPoint) : 0;
}

function prizeRowHtml(p, pos, dollarPerPoint) {
  const pesos = prizePesos(p);
  // Los sorteos viejos decían "Crédito GoDelivery": ahora el premio son Puntos GO.
  const description = !p.description || p.description === 'Crédito GoDelivery' ? 'en Puntos GO' : p.description;
  return `
    <div class="prize-row">
      <div>
        <div class="form-label">Pos.</div>
        <input type="number" class="form-input prize-pos" value="${esc(p.position ?? pos)}" style="text-align:center; padding:12px 4px;">
      </div>
      <div>
         <div class="form-label">Pesos</div>
         <input type="number" min="0" step="1000" class="form-input prize-pesos" value="${pesos || ''}" placeholder="40000">
      </div>
      <div>
         <div class="form-label">Badge</div>
         <input type="text" class="form-input prize-badge" value="${esc(p.badge ?? `${pos}º Premio`)}">
      </div>
      <div class="prize-points" style="grid-column: 1 / -1; font-size:13px; font-weight:700; color:#b45309;">${pesos ? `= ${fmtNum(pointsFor(pesos, dollarPerPoint))} Puntos GO` : 'Cargá el premio en pesos'}</div>
      <div style="grid-column: 1 / -1;">
         <input type="text" class="form-input prize-desc" value="${esc(description)}" placeholder="Descripción">
      </div>
      <div style="grid-column: 1 / -1; text-align:right; margin-bottom:12px;">
         <button type="button" class="btn-remove-prize" style="background:none; border:none; color:#ef4444; font-size:12px; font-weight:600; cursor:pointer; padding:4px;">${icon('trash', 14)} Eliminar premio</button>
         <hr style="border:none; border-top:1px solid #e2e8f0; margin-top:8px;">
      </div>
    </div>
  `;
}

function functionUrl(name) {
  return `https://us-central1-${db.app.options.projectId}.cloudfunctions.net/${name}`;
}

// 'active' = visible en /sorteo; 'status' = etapa. Prender un borrador lo pasa
// a activo: si no, el servidor no acepta participantes ni manda los avisos.
function syncStatusWithActive(active, status) {
  if (active && (!status || status === 'draft')) return 'active';
  return status || 'draft';
}

function toDatetimeLocal(timestamp) {
  if (!timestamp) return '';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  const pad = (n) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromDatetimeLocal(string) {
  if (!string) return null;
  return Timestamp.fromDate(new Date(string));
}

function formatDate(timestamp) {
  if (!timestamp) return '';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function getStatusBadge(status) {
  const styles = {
    draft: 'background:#f1f5f9; color:#475569; border:1px solid #e2e8f0;',
    active: 'background:#dcfce7; color:#166534; border:1px solid #bbf7d0;',
    ended: 'background:#fef3c7; color:#92400e; border:1px solid #fde68a;',
    drawing: 'background:#ede9fe; color:#5b21b6; border:1px solid #ddd6fe;',
    drawn: 'background:#ffe4e6; color:#be123c; border:1px solid #fecdd3;'
  };
  const labels = {
    draft: 'Borrador',
    active: 'Activo',
    ended: 'Finalizado',
    drawing: 'Sorteando…',
    drawn: 'Sorteado'
  };
  return `<span style="font-size:12px; font-weight:600; padding:2px 8px; border-radius:12px; ${styles[status] || styles.draft}">${labels[status] || 'Borrador'}</span>`;
}

// --- List View ---

export function renderAdminSorteos(container) {
  if (!isAdmin()) {
    container.innerHTML = '<div style="padding:20px; text-align:center;">Acceso denegado</div>';
    return { cleanup: () => {} };
  }

  let unsubscribe = null;

  const html = `
    <style>
      .settings-switch { position:relative; display:inline-block; width:44px; height:24px; margin:0; flex-shrink:0; }
      .settings-switch input { opacity:0; width:0; height:0; }
      .settings-slider { position:absolute; cursor:pointer; top:0; left:0; right:0; bottom:0; background-color:#cbd5e1; transition:.3s; border-radius:24px; }
      .settings-slider:before { position:absolute; content:""; height:18px; width:18px; left:3px; bottom:3px; background-color:white; transition:.3s; border-radius:50%; box-shadow:0 2px 4px rgba(0,0,0,0.15); }
      .settings-switch input:checked + .settings-slider { background-color:var(--go-red,#e11d48); }
      .settings-switch input:checked + .settings-slider:before { transform:translateX(20px); }
      
      .giveaway-card {
        background:var(--color-surface, #ffffff); border:1px solid var(--color-border, #e2e8f0); border-radius:22px; padding:18px;
        margin-bottom: 12px;
        display: flex; flex-direction: column; gap: 12px;
        cursor: pointer;
        transition: transform 0.2s, box-shadow 0.2s;
      }
      .giveaway-card:active {
        transform: scale(0.98);
      }
    </style>
    <div style="background:var(--go-ink,#0b0b0c); padding:16px 20px calc(16px + env(safe-area-inset-top,0px)); display:flex; align-items:center; gap:12px; position:sticky; top:0; z-index:10;">
      <a href="#/admin" style="color:var(--go-on-ink,#f7f5f1); display:flex; align-items:center; text-decoration:none;">${icon('chevronLeft', 24)}</a>
      <div style="flex:1;">
        <div style="font-family:var(--font-display,'Montserrat'); font-weight:900; font-size:20px; color:var(--go-on-ink,#f7f5f1);">Sorteos</div>
        <div style="font-size:11px; text-transform:uppercase; color:rgba(255,255,255,0.7); font-weight:700; letter-spacing:0.06em;">Gestión de sorteos</div>
      </div>
      <button id="btn-new-sorteo" style="background:rgba(255,255,255,0.1); border:none; color:white; width:36px; height:36px; border-radius:18px; display:flex; align-items:center; justify-content:center; cursor:pointer;">${icon('plus', 20)}</button>
    </div>
    
    <div style="padding:20px;">
      <div id="sorteos-list" style="display:flex; flex-direction:column; gap:12px;">
        <div style="text-align:center; padding:40px; color:#64748b; font-size:14px;">Cargando sorteos...</div>
      </div>
    </div>
  `;

  container.innerHTML = html;

  const btnNew = container.querySelector('#btn-new-sorteo');
  btnNew.addEventListener('click', async () => {
    btnNew.disabled = true;
    try {
      const docRef = await addDoc(collection(db, 'giveaways'), {
        title: 'Nuevo Sorteo',
        subtitle: '',
        active: false,
        status: 'draft',
        endsAt: Timestamp.fromDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)), // 7 days from now
        targetAudience: 'all',
        // Sin 'points': se calculan al guardar (y el servidor los calcula si faltan).
        prizes: [40000, 20000, 10000, 6000, 6000, 6000, 6000, 6000].map((pesos, i) => ({
          position: i + 1, amount: `$${fmtNum(pesos)}`, pesosValue: pesos,
          description: 'en Puntos GO', badge: `${i + 1}º Premio`
        })),
        chanceRules: { registration: 1, order: 5, referral: 2, appInstalled: 2 },
        shareMessage: '¡Participá del nuevo sorteo en GoDelivery y ganá premios increíbles!',
        totalParticipants: 0,
        notifications: { oneHourSent: false, tenMinutesSent: false },
        winners: [],
        autoDraw: true,
        totalChances: 0,
        createdAt: serverTimestamp()
      });
      window.location.hash = `#/admin/sorteos/${docRef.id}`;
    } catch (err) {
      console.error(err);
      showToast('Error al crear sorteo', 'error');
      btnNew.disabled = false;
    }
  });

  const q = query(collection(db, 'giveaways'), orderBy('createdAt', 'desc'));
  unsubscribe = onSnapshot(q, (snapshot) => {
    const listEl = container.querySelector('#sorteos-list');
    if (snapshot.empty) {
      listEl.innerHTML = '<div style="text-align:center; padding:40px; color:#64748b; font-size:14px;">No hay sorteos creados</div>';
      return;
    }

    let htmlList = '';
    snapshot.forEach(docSnap => {
      const data = docSnap.data();
      const id = docSnap.id;
      
      htmlList += `
        <div class="giveaway-card" onclick="window.location.hash='#/admin/sorteos/${id}'">
          <div style="display:flex; justify-content:space-between; align-items:flex-start;">
            <div style="flex:1; padding-right:12px;">
              <div style="font-weight:700; font-size:16px; color:#0f172a; margin-bottom:4px;">${esc(data.title || 'Sin título')}</div>
              ${data.subtitle ? `<div style="font-size:13px; color:#475569; margin-bottom:8px;">${esc(data.subtitle)}</div>` : ''}
              <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                ${getStatusBadge(data.status || 'draft')}
                <span style="font-size:12px; color:#64748b; display:flex; align-items:center; gap:4px;">
                  ${icon('users', 14)} ${data.totalParticipants || 0}
                </span>
                <span style="font-size:12px; color:#64748b; display:flex; align-items:center; gap:4px;">
                  ${icon('clock', 14)} ${formatDate(data.endsAt)}
                </span>
              </div>
            </div>
            <div onclick="event.stopPropagation()">
              <label class="settings-switch">
                <input type="checkbox" class="toggle-active" data-id="${id}" ${data.active ? 'checked' : ''}>
                <span class="settings-slider"></span>
              </label>
            </div>
          </div>
        </div>
      `;
    });
    
    listEl.innerHTML = htmlList;

    listEl.querySelectorAll('.toggle-active').forEach(toggle => {
      toggle.addEventListener('change', async (e) => {
        const id = e.target.dataset.id;
        const active = e.target.checked;
        try {
          const current = snapshot.docs.find(d => d.id === id)?.data() || {};
          await updateDoc(doc(db, 'giveaways', id), { active, status: syncStatusWithActive(active, current.status) });
          showToast(active ? 'Sorteo activado' : 'Sorteo desactivado', 'success');
        } catch (err) {
          console.error(err);
          e.target.checked = !active; // revert
          showToast('Error al actualizar estado', 'error');
        }
      });
    });
  }, (err) => {
    console.error('Error listening to giveaways', err);
    const listEl = container.querySelector('#sorteos-list');
    if (listEl) {
      listEl.innerHTML = `
        <div style="text-align:center; padding:40px 20px; background:var(--color-surface); border:1px solid var(--color-border); border-radius:22px;">
          <div style="font-size:32px; margin-bottom:8px;">🎰</div>
          <div style="font-weight:800; font-size:16px; color:var(--color-text); margin-bottom:4px;">No hay sorteos creados aún</div>
          <div style="font-size:13px; color:var(--color-text-tertiary); margin-bottom:16px;">Toca el botón <strong>+</strong> de arriba para crear el primer sorteo.</div>
        </div>
      `;
    }
  });

  return { cleanup: () => { if (unsubscribe) unsubscribe(); } };
}


// --- Editor View ---

export function renderAdminSorteoEditor(container) {
  if (!isAdmin()) {
    container.innerHTML = '<div style="padding:20px; text-align:center;">Acceso denegado</div>';
    return { cleanup: () => {} };
  }

  let dollarPerPoint = 1;
  const settingsReady = getDoc(doc(db, 'settings', 'global')).then((snap) => {
    const v = Number(snap.data()?.dollarPerPoint);
    if (Number.isFinite(v) && v > 0) dollarPerPoint = v;
  }).catch(() => {});

  function updatePrizeTotals() {
    const el = container.querySelector('#prizes-total');
    if (!el) return;
    let pesosTotal = 0, pointsTotal = 0;
    container.querySelectorAll('.prize-row').forEach((row) => {
      const pesos = Math.max(0, Math.round(Number(row.querySelector('.prize-pesos').value) || 0));
      const pts = pointsFor(pesos, dollarPerPoint);
      pesosTotal += pesos;
      pointsTotal += pts;
      row.querySelector('.prize-points').textContent = pesos ? `= ${fmtNum(pts)} Puntos GO` : 'Cargá el premio en pesos';
    });
    const count = container.querySelectorAll('.prize-row').length;
    el.textContent = `Total: $${fmtNum(pesosTotal)} = ${fmtNum(pointsTotal)} Puntos GO · ${count} ${count === 1 ? 'ganador' : 'ganadores'}`;
  }

  const id = window.location.hash.split('/').pop();
  if (!id || id === 'sorteos') {
    window.location.hash = '#/admin/sorteos';
    return { cleanup: () => {} };
  }

  let unsubscribeGiveaway = null;
  let unsubscribeEntries = null;
  let currentData = null;

  container.innerHTML = `
    <style>
      .settings-switch { position:relative; display:inline-block; width:44px; height:24px; margin:0; flex-shrink:0; }
      .settings-switch input { opacity:0; width:0; height:0; }
      .settings-slider { position:absolute; cursor:pointer; top:0; left:0; right:0; bottom:0; background-color:#cbd5e1; transition:.3s; border-radius:24px; }
      .settings-slider:before { position:absolute; content:""; height:18px; width:18px; left:3px; bottom:3px; background-color:white; transition:.3s; border-radius:50%; box-shadow:0 2px 4px rgba(0,0,0,0.15); }
      .settings-switch input:checked + .settings-slider { background-color:var(--go-red,#e11d48); }
      .settings-switch input:checked + .settings-slider:before { transform:translateX(20px); }
      
      .editor-section { background:var(--color-surface, #ffffff); border:1px solid var(--color-border, #e2e8f0); border-radius:22px; padding:18px; margin-bottom:16px; }
      .editor-title { font-weight:700; font-size:16px; margin-bottom:16px; color:#0f172a; display:flex; align-items:center; gap:8px; }
      
      .form-group { margin-bottom: 12px; }
      .form-label { display:block; font-size:12px; font-weight:600; color:#475569; margin-bottom:4px; text-transform:uppercase; letter-spacing:0.05em; }
      .form-input { width:100%; padding:12px; border:1px solid #cbd5e1; border-radius:12px; font-size:15px; background:#f8fafc; outline:none; transition:border-color 0.2s; box-sizing:border-box; }
      .form-input:focus { border-color:var(--go-ink,#0b0b0c); background:white; }
      
      .btn-save { background:var(--go-ink,#0b0b0c); color:white; border:none; padding:16px; border-radius:16px; font-weight:700; font-size:16px; width:100%; cursor:pointer; margin-bottom:12px; }
      .btn-draw { background:var(--go-red,#e11d48); color:white; border:none; padding:16px; border-radius:16px; font-weight:700; font-size:16px; width:100%; cursor:pointer; margin-bottom:12px; }
      .btn-delete { background:transparent; color:#ef4444; border:1px solid #ef4444; padding:12px; border-radius:16px; font-weight:600; font-size:14px; width:100%; cursor:pointer; }
      
      .prize-row { display:grid; grid-template-columns: 60px 1fr 1fr; gap:8px; margin-bottom:8px; align-items:start; }
      
      .table-container { overflow-x: auto; margin-top: 12px; }
      table { width: 100%; border-collapse: collapse; font-size: 13px; }
      th { text-align: left; padding: 8px; border-bottom: 2px solid #e2e8f0; color: #475569; font-weight: 600; }
      td { padding: 8px; border-bottom: 1px solid #e2e8f0; color: #0f172a; }
    </style>

    <div style="background:var(--go-ink,#0b0b0c); padding:16px 20px calc(16px + env(safe-area-inset-top,0px)); display:flex; align-items:center; gap:12px; position:sticky; top:0; z-index:10;">
      <a href="#/admin/sorteos" style="color:var(--go-on-ink,#f7f5f1); display:flex; align-items:center; text-decoration:none;">${icon('chevronLeft', 24)}</a>
      <div style="flex:1;">
        <div id="header-title" style="font-family:var(--font-display,'Montserrat'); font-weight:900; font-size:18px; color:var(--go-on-ink,#f7f5f1); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">Cargando...</div>
        <div style="font-size:11px; text-transform:uppercase; color:rgba(255,255,255,0.7); font-weight:700; letter-spacing:0.06em;">Editar sorteo</div>
      </div>
      <div id="header-badge"></div>
    </div>

    <div style="padding:20px; padding-bottom:100px;" id="editor-content">
      <div style="text-align:center; padding:40px; color:#64748b;">Cargando datos...</div>
    </div>
  `;

  unsubscribeGiveaway = onSnapshot(doc(db, 'giveaways', id), (docSnap) => {
    if (!docSnap.exists()) {
      showToast('Sorteo no encontrado', 'error');
      window.location.hash = '#/admin/sorteos';
      return;
    }
    
    const isFirstLoad = !currentData;
    currentData = docSnap.data();
    
    // Update Header
    container.querySelector('#header-title').textContent = currentData.title || 'Sin título';
    container.querySelector('#header-badge').innerHTML = getStatusBadge(currentData.status || 'draft');

    if (isFirstLoad) {
      renderForm();
      // Recalcula con el valor real del punto cuando llega settings/global.
      settingsReady.then(() => {
        const rate = container.querySelector('#prizes-rate');
        if (rate) rate.textContent = fmtRate(dollarPerPoint);
        updatePrizeTotals();
      });
      attachListeners();
      loadEntries();
    } else {
      const countEl = container.querySelector('#total-participants-count');
      if (countEl) countEl.textContent = currentData.totalParticipants || 0;

      const winnersSection = container.querySelector('#winners-section');
      if (winnersSection && currentData.status === 'drawn') {
         renderWinners(winnersSection);
      }
      renderLiveState();
    }
  });

  function renderForm() {
    const d = currentData;
    
    const prizesHtml = (d.prizes || []).map((p, i) => prizeRowHtml(p, i + 1, dollarPerPoint)).join('');

    const html = `
      <!-- General -->
      <div class="editor-section">
        <div class="editor-title">${icon('settings', 18)} General</div>
        
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
          <div style="font-weight:600; font-size:14px; color:#0f172a;">Sorteo Activo</div>
          <label class="settings-switch">
            <input type="checkbox" id="inp-active" ${d.active ? 'checked' : ''}>
            <span class="settings-slider"></span>
          </label>
        </div>
        
        <div class="form-group">
          <label class="form-label">Título</label>
          <input type="text" id="inp-title" class="form-input" value="${esc(d.title)}">
        </div>

        <div class="form-group">
          <label class="form-label">Subtítulo</label>
          <input type="text" id="inp-subtitle" class="form-input" value="${esc(d.subtitle)}">
        </div>

        <div class="form-group">
          <label class="form-label">Fecha y hora del sorteo</label>
          <input type="datetime-local" id="inp-endsAt" class="form-input" value="${toDatetimeLocal(d.endsAt)}">
          <div style="font-size:12px; color:#64748b; margin-top:6px; line-height:1.4;">A esa hora se cierra la participación. Los avisos push salen 1 hora y 10 minutos antes.</div>
        </div>

        <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; margin:4px 0 16px;">
          <div>
            <div style="font-weight:600; font-size:14px; color:#0f172a;">Sortear automáticamente</div>
            <div style="font-size:12px; color:#64748b; line-height:1.4;">Al llegar la hora se eligen los ganadores solos y la página los muestra en vivo. Apagado, lo hacés vos con el botón.</div>
          </div>
          <label class="settings-switch">
            <input type="checkbox" id="inp-autoDraw" ${d.autoDraw === true ? 'checked' : ''}>
            <span class="settings-slider"></span>
          </label>
        </div>

        <div class="form-group">
          <label class="form-label">Estado Manual</label>
          <select id="inp-status" class="form-input">
            <option value="draft" ${d.status === 'draft' ? 'selected' : ''}>Borrador</option>
            <option value="active" ${d.status === 'active' ? 'selected' : ''}>Activo</option>
            <option value="ended" ${d.status === 'ended' ? 'selected' : ''}>Finalizado</option>
            <option value="drawn" ${d.status === 'drawn' ? 'selected' : ''}>Sorteado</option>
          </select>
        </div>

        <div id="reminders-info"></div>

        <div class="form-group">
          <label class="form-label">Público objetivo</label>
          <select id="inp-audience" class="form-input">
            <option value="all" ${d.targetAudience === 'all' ? 'selected' : ''}>Todos</option>
            <option value="clients" ${d.targetAudience === 'clients' ? 'selected' : ''}>Solo clientes (sin repartidores ni comercios)</option>
            <option value="drivers" ${d.targetAudience === 'drivers' ? 'selected' : ''}>Solo repartidores</option>
            <option value="stores" ${d.targetAudience === 'stores' ? 'selected' : ''}>Solo comercios</option>
          </select>
        </div>
      </div>

      <!-- Enlace del Sorteo -->
      <div class="editor-section" style="background:linear-gradient(135deg, #0b0b0c, #161618); color:white; border:1px solid #2c2c30;">
        <div style="display:flex; align-items:center; gap:8px; font-weight:800; font-size:15px; margin-bottom:6px; color:#fff;">
          ${icon('link', 18)} Enlace de Acceso al Sorteo
        </div>
        <div style="font-size:12px; color:#a8a29e; margin-bottom:12px; line-height:1.4;">
          Compartí este enlace con los vecinos de Magdalena para que entren a la web del sorteo y sumen sus chances.
        </div>
        <div style="display:flex; gap:8px; margin-bottom:12px;">
          <input type="text" id="admin-giveaway-url" readonly value="${window.location.origin}/sorteo" style="flex:1; background:#202023; border:1px solid #2c2c30; color:#f7f5f1; border-radius:12px; padding:10px 12px; font-size:13px; font-family:monospace;" onclick="this.select()">
          <button type="button" id="btn-copy-giveaway-url" style="background:var(--go-red,#e11d48); color:white; border:none; padding:10px 16px; border-radius:12px; font-weight:700; font-size:13px; cursor:pointer; white-space:nowrap; transition:all 0.2s;">
            Copiar
          </button>
        </div>
        <div style="display:flex; gap:8px;">
          <button type="button" id="btn-share-wa-giveaway" style="flex:1; background:#25D366; color:white; border:none; padding:10px; border-radius:12px; font-weight:700; font-size:13px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px;">
            <span>📲</span> Compartir por WhatsApp
          </button>
          <a id="btn-open-giveaway-link" href="/sorteo" target="_blank" style="background:#202023; color:#f7f5f1; border:1px solid #2c2c30; text-decoration:none; padding:10px 16px; border-radius:12px; font-weight:700; font-size:13px; display:flex; align-items:center; gap:4px;">
            <span>🌐</span> Abrir
          </a>
        </div>
      </div>
      
      <!-- Premios -->
      <div class="editor-section">
        <div class="editor-title">${icon('gift', 18)} Premios</div>
        <div style="font-size:12px; color:#64748b; margin-bottom:12px; line-height:1.4;">Cargá cada premio en pesos: se pasa solo a Puntos GO (1 punto = $<span id="prizes-rate">${fmtRate(dollarPerPoint)}</span>) y se acredita a cada ganador apenas se sortea, con su aviso.</div>
        <div id="prizes-total" style="background:#fffbeb; border:1px solid #fde68a; border-radius:12px; padding:10px 12px; font-size:14px; font-weight:700; color:#92400e; margin-bottom:12px;"></div>
        <div id="prizes-list">
          ${prizesHtml}
        </div>
        <button id="btn-add-prize" style="background:#f1f5f9; color:#0f172a; border:1px dashed #cbd5e1; padding:12px; border-radius:12px; font-weight:600; font-size:14px; width:100%; cursor:pointer;">
          + Agregar premio
        </button>
      </div>
      
      <!-- Reglas -->
      <div class="editor-section">
        <div class="editor-title">${icon('list', 18)} Reglas de Chances</div>
        <div class="form-group">
          <label class="form-label">Por registro / base</label>
          <input type="number" id="inp-chance-reg" class="form-input" value="${d.chanceRules?.registration || 1}">
        </div>
        <div class="form-group">
          <label class="form-label">Por pedido (clientes)</label>
          <input type="number" id="inp-chance-order" class="form-input" value="${d.chanceRules?.order || 5}">
        </div>
        <div class="form-group">
          <label class="form-label">Por referido</label>
          <input type="number" id="inp-chance-ref" class="form-input" value="${d.chanceRules?.referral || 2}">
        </div>
        <div class="form-group">
          <label class="form-label">Por App Instalada</label>
          <input type="number" id="inp-chance-app" class="form-input" value="${d.chanceRules?.appInstalled || 2}">
        </div>
      </div>
      
      <!-- Mensaje -->
      <div class="editor-section">
        <div class="editor-title">${icon('messageCircle', 18)} Mensaje para compartir</div>
        <div class="form-group">
          <textarea id="inp-share" class="form-input" rows="4" style="resize:vertical;">${esc(d.shareMessage)}</textarea>
          <div style="font-size:12px; color:#64748b; margin-top:6px;">El link personal de invitación se agrega solo al final.</div>
        </div>
      </div>
      
      <!-- Ganadores (Si sorteado) -->
      <div id="winners-section" style="${d.status === 'drawn' ? 'display:block;' : 'display:none;'}">
        <!-- Renders dynamically -->
      </div>
      
      <!-- Participantes (Read-Only) -->
      <div class="editor-section">
        <div class="editor-title">
          ${icon('users', 18)} Participantes 
          <span style="background:#f1f5f9; padding:2px 8px; border-radius:10px; font-size:12px; margin-left:auto;" id="total-participants-count">${d.totalParticipants || 0}</span>
        </div>
        <div class="table-container">
          <table id="entries-table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Chances</th>
                <th>Prob.</th>
                <th>Se anotó</th>
              </tr>
            </thead>
            <tbody>
              <tr><td colspan="4" style="text-align:center; color:#64748b;">Cargando...</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Actions -->
      <button id="btn-save" class="btn-save">Guardar cambios</button>
      <div id="draw-panel"></div>
      <div style="margin-top:32px;">
        <button id="btn-delete" class="btn-delete">Eliminar sorteo</button>
      </div>
    `;

    container.querySelector('#editor-content').innerHTML = html;
    if (d.status === 'drawn') renderWinners(container.querySelector('#winners-section'));
    renderLiveState();
  }

  // Lo que cambia solo mientras el admin mira (estado, avisos, botón de sorteo):
  // se repinta en cada snapshot sin tocar el formulario que está editando.
  function renderLiveState() {
    const d = currentData;
    const endsMs = d.endsAt?.toMillis ? d.endsAt.toMillis() : 0;
    const n = d.notifications || {};
    const reminderRow = (label, sent) => `
      <div style="display:flex; justify-content:space-between; font-size:13px; padding:6px 0;">
        <span style="color:#475569;">${label}</span>
        <span style="font-weight:700; color:${sent ? '#166534' : '#94a3b8'};">${sent ? 'Enviado ✓' : 'Pendiente'}</span>
      </div>`;
    const remindersEl = container.querySelector('#reminders-info');
    if (remindersEl) {
      remindersEl.innerHTML = `
        <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:8px 12px;">
          <div class="form-label" style="margin:4px 0;">Avisos push</div>
          ${reminderRow('1 hora antes', endsMs && n.oneHourFor === endsMs)}
          ${reminderRow('10 minutos antes', endsMs && n.tenMinutesFor === endsMs)}
          ${d.active && d.status !== 'active' && d.status !== 'drawn' ? `<div style="font-size:12px; color:#b45309; margin-top:6px;">El estado no es "Activo": no se aceptan participantes ni salen avisos.</div>` : ''}
        </div>`;
    }

    const panel = container.querySelector('#draw-panel');
    if (!panel) return;
    const errors = {
      no_entries: 'No se pudo sortear: no hay participantes.',
      no_prizes: 'No se pudo sortear: no hay premios cargados.',
      stale: 'El último intento de sorteo se cortó. Podés volver a intentarlo.'
    };
    const errorHtml = d.drawError
      ? `<div style="background:#fef2f2; border:1px solid #fecaca; color:#b91c1c; border-radius:12px; padding:10px 12px; font-size:13px; margin-bottom:12px;">${esc(errors[d.drawError] || 'El último intento de sorteo falló.')}</div>`
      : '';
    if (d.status === 'drawing') {
      panel.innerHTML = `<button class="btn-draw" disabled style="opacity:.6;">Sorteando…</button>`;
    } else if (d.status === 'drawn') {
      panel.innerHTML = `${errorHtml}<button id="btn-draw" class="btn-delete" data-redraw="1" style="margin-bottom:12px;">Volver a sortear (reemplaza a los ganadores)</button>`;
    } else {
      panel.innerHTML = `${errorHtml}<button id="btn-draw" class="btn-draw">Realizar sorteo ahora</button>`;
    }
    panel.querySelector('#btn-draw')?.addEventListener('click', onDrawClick);
  }

  async function onDrawClick(e) {
    const btn = e.currentTarget;
    const redraw = btn.dataset.redraw === '1';
    const msg = redraw
      ? '¿Volver a sortear? Se eligen ganadores nuevos y se reemplazan los actuales. OJO: los ganadores anteriores ya recibieron su aviso y sus Puntos GO, y los conservan. A los nuevos también se les acreditan.'
      : '¿Realizar el sorteo AHORA? Se eligen los ganadores, se les acreditan los Puntos GO, se les avisa por push y no se puede deshacer.';
    if (!confirm(msg)) return;

    btn.textContent = 'Sorteando...';
    btn.disabled = true;
    try {
      const user = auth.currentUser;
      if (!user) throw new Error('No hay sesión');
      const token = await user.getIdToken();
      const res = await fetch(functionUrl('manualGiveawayDraw'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ giveawayId: id, redraw })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || data.error || `Error ${res.status}`);
      showToast('Sorteo realizado con éxito', 'success');
    } catch (err) {
      console.error(err);
      showToast('Error al sortear: ' + err.message, 'error');
      renderLiveState();
    }
  }
  
  function renderWinners(el) {
    if (!currentData || !currentData.winners || currentData.winners.length === 0) {
      el.innerHTML = `
        <div class="editor-section" style="background:#fffbeb; border-color:#fde68a;">
          <div class="editor-title" style="color:#b45309;">${icon('award', 18)} Ganadores</div>
          <div style="font-size:14px; color:#b45309;">No hay ganadores registrados.</div>
        </div>
      `;
      return;
    }
    
    let html = `
      <div class="editor-section" style="background:#fffbeb; border-color:#fde68a;">
        <div class="editor-title" style="color:#b45309;">${icon('award', 18)} Ganadores del Sorteo</div>
        <div style="display:flex; flex-direction:column; gap:12px;">
    `;
    
    currentData.winners.forEach(w => {
      html += `
        <div style="background:white; border:1px solid #fde68a; border-radius:12px; padding:12px; display:flex; gap:12px; align-items:center;">
          <div style="width:36px; height:36px; border-radius:18px; background:#fef3c7; color:#b45309; display:flex; align-items:center; justify-content:center; font-weight:700;">
            #${w.position}
          </div>
          <div style="flex:1;">
            <div style="font-weight:700; color:#92400e; font-size:15px;">${esc(w.userName || 'Usuario anónimo')}</div>
            <div style="font-size:12px; color:#b45309;">${esc(w.prizeAmount)} - ${esc(w.prizeDescription)}${w.chances ? ` · ${w.chances} chances` : ''}</div>
            <div style="font-size:12px; font-weight:700; color:${currentData.credited?.[w.userId] ? '#15803d' : '#b45309'};">${currentData.credited?.[w.userId] ? `✓ Acreditados ${fmtNum(currentData.credited[w.userId])} Puntos GO` : 'Puntos sin acreditar todavía'}</div>
            <div style="font-size:11px; color:#b45309; opacity:.8; font-family:monospace;">${esc(w.userId)}</div>
          </div>
        </div>
      `;
    });
    
    html += `</div></div><div id="story-video-box"></div>`;
    el.innerHTML = html;
    el.style.display = 'block';
    renderStoryVideo(el.querySelector('#story-video-box'));
  }

  // ---------------------------------------------------------------- video para stories
  // Se genera solo (en este dispositivo) cuando el sorteo ya salió y no tiene video, se guarda en
  // Storage y queda en el sorteo (storyVideo). Si se vuelve a sortear, se genera uno nuevo.
  const story = { generatingFor: null, progress: 0, error: '', localUrl: null };

  function drawnKeyOf(d) {
    const ms = d?.drawnAt?.toMillis?.() || (d?.drawnAt?.seconds ? d.drawnAt.seconds * 1000 : 0);
    return String(ms || 'sin-fecha');
  }

  async function renderStoryVideo(box) {
    if (!box || !currentData || currentData.status !== 'drawn' || !currentData.winners?.length) return;
    const { canRenderGiveawayVideo } = await import('../../utils/giveaway-video.js');
    const key = drawnKeyOf(currentData);
    const saved = currentData.storyVideo;
    const upToDate = saved?.url && saved.forDrawnAt === key;
    const canRender = canRenderGiveawayVideo();

    let body;
    if (story.generatingFor === key) {
      body = `
        <div style="font-size:13px; color:#334155; margin-bottom:10px;">Generando el video… dejá esta pantalla abierta (tarda lo que dura el video, unos 30 segundos).</div>
        <div style="height:10px; border-radius:6px; background:#e2e8f0; overflow:hidden;"><div id="story-progress" style="height:100%; width:${Math.round(story.progress * 100)}%; background:#e11d48; transition:width .3s;"></div></div>`;
    } else if (upToDate) {
      body = `
        <div style="display:flex; gap:16px; align-items:flex-start; flex-wrap:wrap;">
          <video src="${esc(saved.url)}#t=12" controls playsinline preload="metadata" style="width:200px; aspect-ratio:9/16; border-radius:16px; background:#000;"></video>
          <div style="display:flex; flex-direction:column; gap:8px; flex:1; min-width:160px;">
            <button class="btn-draw" id="story-download" style="margin:0;">Descargar video</button>
            ${navigator.canShare ? '<button class="btn-draw" id="story-share" style="margin:0; background:#0b0b0c;">Compartir (Instagram, WhatsApp…)</button>' : ''}
            <button id="story-regen" style="background:none; border:none; color:#64748b; font-size:13px; text-decoration:underline; cursor:pointer; text-align:left; padding:4px 0;">Volver a generar</button>
            <div style="font-size:12px; color:#64748b;">Vertical 1080×1920, listo para stories. ${saved.ext === 'webm' ? 'Este navegador lo grabó en WebM: si Instagram no lo acepta, generalo desde Chrome actualizado.' : ''}</div>
          </div>
        </div>`;
    } else if (!canRender) {
      body = `<div style="font-size:13px; color:#b45309;">Este navegador no puede grabar el video. Abrí este sorteo desde Chrome (PC o Android) y se genera solo.</div>`;
    } else {
      body = `
        ${story.error ? `<div style="font-size:13px; color:#b91c1c; margin-bottom:10px;">No se pudo generar: ${esc(story.error)}</div>` : ''}
        <button class="btn-draw" id="story-generate" style="margin:0;">Generar video para stories</button>`;
    }
    box.innerHTML = `
      <div class="editor-section">
        <div class="editor-title">🎬 Video del sorteo para stories</div>
        ${body}
      </div>`;

    box.querySelector('#story-generate')?.addEventListener('click', () => generateStoryVideo());
    box.querySelector('#story-regen')?.addEventListener('click', () => generateStoryVideo());
    box.querySelector('#story-download')?.addEventListener('click', () => downloadStoryVideo(saved));
    box.querySelector('#story-share')?.addEventListener('click', () => shareStoryVideo(saved));

    // Recién sorteado y sin video: se genera solo, una vez
    if (!upToDate && canRender && !story.generatingFor && !story.error) generateStoryVideo();
  }

  async function generateStoryVideo() {
    if (story.generatingFor) return;
    const key = drawnKeyOf(currentData);
    story.generatingFor = key;
    story.progress = 0;
    story.error = '';
    const box = () => container.querySelector('#story-video-box');
    renderStoryVideo(box());
    try {
      const { renderGiveawayVideo } = await import('../../utils/giveaway-video.js');
      const snapshot = { ...currentData };
      const { blob, mime, ext } = await renderGiveawayVideo(snapshot, {
        onProgress: (p) => {
          story.progress = p;
          const bar = container.querySelector('#story-progress');
          if (bar) bar.style.width = `${Math.round(p * 100)}%`;
        },
      });
      const { storage } = await import('../../firebase.js');
      const { ref, uploadBytes, getDownloadURL } = await import('firebase/storage');
      const path = `giveaways/${id}/stories-${key}.${ext}`;
      const fileRef = ref(storage, path);
      await uploadBytes(fileRef, blob, { contentType: mime });
      const url = await getDownloadURL(fileRef);
      await updateDoc(doc(db, 'giveaways', id), {
        storyVideo: { url, path, mime, ext, forDrawnAt: key, size: blob.size, createdAt: serverTimestamp() },
      });
      showToast('Video del sorteo listo y guardado', 'success');
    } catch (err) {
      console.error('[Sorteo] No se pudo generar el video:', err);
      story.error = err?.message || String(err);
      showToast('No se pudo generar el video del sorteo', 'error');
    } finally {
      story.generatingFor = null;
      renderStoryVideo(box());
    }
  }

  async function storyVideoFile(saved) {
    const res = await fetch(saved.url);
    if (!res.ok) throw new Error(`No se pudo bajar el video (${res.status})`);
    const blob = await res.blob();
    const name = `sorteo-go-${(currentData.title || 'go').toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)}.${saved.ext || 'mp4'}`;
    return new File([blob], name, { type: saved.mime || blob.type });
  }

  async function downloadStoryVideo(saved) {
    try {
      const file = await storyVideoFile(saved);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(file);
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    } catch (err) {
      // Sin poder bajarlo (o en la app nativa): se abre el video y se guarda desde ahí
      window.open(saved.url, '_blank');
    }
  }

  async function shareStoryVideo(saved) {
    try {
      const file = await storyVideoFile(saved);
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: currentData.title || 'Sorteo GO!' });
      } else {
        await downloadStoryVideo(saved);
      }
    } catch (err) {
      if (err?.name !== 'AbortError') downloadStoryVideo(saved);
    }
  }

  function attachListeners() {
    // Copy giveaway URL
    const btnCopyUrl = container.querySelector('#btn-copy-giveaway-url');
    if (btnCopyUrl) {
      btnCopyUrl.addEventListener('click', () => {
        const input = container.querySelector('#admin-giveaway-url');
        if (input) {
          navigator.clipboard.writeText(input.value).then(() => {
            showToast('¡Enlace copiado al portapapeles!', 'success');
          }).catch(() => {
            input.select();
            document.execCommand('copy');
            showToast('¡Enlace copiado al portapapeles!', 'success');
          });
        }
      });
    }

    // Share via WhatsApp
    const btnShareWa = container.querySelector('#btn-share-wa-giveaway');
    if (btnShareWa) {
      btnShareWa.addEventListener('click', () => {
        const input = container.querySelector('#admin-giveaway-url');
        const url = input ? input.value : `${window.location.origin}/sorteo`;
        const msg = encodeURIComponent(`🎉 ¡Participá del sorteo exclusivo en GoDelivery! Entrá acá para sumar tus chances:\n\n${url}`);
        window.open(`https://wa.me/?text=${msg}`, '_blank');
      });
    }

    // Add prize
    const btnAddPrize = container.querySelector('#btn-add-prize');
    if (btnAddPrize) {
      btnAddPrize.addEventListener('click', () => {
        const list = container.querySelector('#prizes-list');
        const pos = list.querySelectorAll('.prize-row').length + 1;
        const div = document.createElement('div');
        div.innerHTML = prizeRowHtml({ position: pos }, pos, dollarPerPoint);
        list.appendChild(div.firstElementChild);
        updatePrizeTotals();
      });
    }

    // Remove prize delegation
    const prizesList = container.querySelector('#prizes-list');
    if (prizesList) {
      prizesList.addEventListener('click', (e) => {
        if (e.target.closest('.btn-remove-prize')) {
          e.target.closest('.prize-row').remove();
          // re-index
          prizesList.querySelectorAll('.prize-row').forEach((row, idx) => {
            row.querySelector('.prize-pos').value = idx + 1;
          });
          updatePrizeTotals();
        }
      });
      prizesList.addEventListener('input', (e) => {
        if (e.target.closest('.prize-pesos')) updatePrizeTotals();
      });
      updatePrizeTotals();
    }

    // Save
    container.querySelector('#btn-save').addEventListener('click', async () => {
      const btn = container.querySelector('#btn-save');
      const originalText = btn.textContent;
      btn.textContent = 'Guardando...';
      btn.disabled = true;

      try {
        const prizes = Array.from(container.querySelectorAll('.prize-row')).map(row => {
          const pesos = Math.max(0, Math.round(Number(row.querySelector('.prize-pesos').value) || 0));
          return {
            position: parseInt(row.querySelector('.prize-pos').value) || 0,
            amount: pesos ? `$${fmtNum(pesos)}` : '',
            pesosValue: pesos,
            points: pointsFor(pesos, dollarPerPoint),
            description: row.querySelector('.prize-desc').value,
            badge: row.querySelector('.prize-badge').value
          };
        });

        const active = container.querySelector('#inp-active').checked;
        const status = syncStatusWithActive(active, container.querySelector('#inp-status').value);
        const endsAt = fromDatetimeLocal(container.querySelector('#inp-endsAt').value);
        if (status === 'active' && !endsAt) {
          throw new Error('Poné la fecha y hora del sorteo');
        }
        if (status === 'active' && endsAt.toMillis() <= Date.now()) {
          throw new Error('La fecha del sorteo ya pasó: poné una fecha futura');
        }
        if (!prizes.length || prizes.some(p => !p.points)) {
          throw new Error('Cada premio necesita un monto en pesos');
        }

        const data = {
          title: container.querySelector('#inp-title').value,
          subtitle: container.querySelector('#inp-subtitle').value,
          active,
          status,
          autoDraw: container.querySelector('#inp-autoDraw').checked,
          targetAudience: container.querySelector('#inp-audience').value,
          endsAt: endsAt || null,
          shareMessage: container.querySelector('#inp-share').value,
          prizes,
          chanceRules: {
            registration: parseInt(container.querySelector('#inp-chance-reg').value) || 0,
            order: parseInt(container.querySelector('#inp-chance-order').value) || 0,
            referral: parseInt(container.querySelector('#inp-chance-ref').value) || 0,
            appInstalled: parseInt(container.querySelector('#inp-chance-app').value) || 0
          }
        };

        await setDoc(doc(db, 'giveaways', id), data, { merge: true });
        container.querySelector('#inp-status').value = status;
        showToast('Sorteo guardado', 'success');
      } catch (err) {
        console.error(err);
        showToast(err.code ? 'Error al guardar' : err.message, 'error');
      } finally {
        btn.textContent = originalText;
        btn.disabled = false;
      }
    });

    // Delete
    container.querySelector('#btn-delete').addEventListener('click', async () => {
      if (!confirm('¿Estás seguro de eliminar este sorteo? Se perderán todos los datos. (Las entradas de participantes no se eliminan automáticamente)')) return;
      try {
        await deleteDoc(doc(db, 'giveaways', id));
        showToast('Sorteo eliminado', 'success');
        window.location.hash = '#/admin/sorteos';
      } catch (err) {
        console.error(err);
        showToast('Error al eliminar', 'error');
      }
    });
  }

  function loadEntries() {
    // Top 50 por chances, para no leer miles de entries en el panel
    const qEntries = query(
      collection(db, `giveaways/${id}/entries`),
      orderBy('chances', 'desc'),
      limit(50)
    );

    unsubscribeEntries = onSnapshot(qEntries, (snapshot) => {
      const tbody = container.querySelector('#entries-table tbody');
      if (!tbody) return;

      if (snapshot.empty) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:#64748b; padding:12px;">Nadie está participando aún</td></tr>';
        return;
      }

      const totalChances = currentData?.totalChances || snapshot.docs.reduce((s, d) => s + (d.data().chances || 0), 0);
      let html = '';
      snapshot.forEach(docSnap => {
        const e = docSnap.data();
        const prob = totalChances ? ((e.chances || 0) / totalChances * 100) : 0;
        html += `
          <tr>
            <td style="font-weight:600;">${esc(e.userName || 'Usuario')}${e.referrals ? `<div style="font-size:11px; color:#64748b; font-weight:500;">${e.referrals} invitado${e.referrals === 1 ? '' : 's'}</div>` : ''}</td>
            <td><span style="background:#f1f5f9; padding:2px 6px; border-radius:6px; font-weight:700;">${e.chances || 0}</span></td>
            <td style="font-size:12px; color:#475569;">${prob < 0.1 && prob > 0 ? '<0.1' : prob.toFixed(1)}%</td>
            <td style="font-size:12px; color:#64748b;">${formatDate(e.joinedAt)}</td>
          </tr>
        `;
      });
      
      tbody.innerHTML = html;
    });
  }

  return { 
    cleanup: () => { 
      if (unsubscribeGiveaway) unsubscribeGiveaway(); 
      if (unsubscribeEntries) unsubscribeEntries(); 
    } 
  };
}
