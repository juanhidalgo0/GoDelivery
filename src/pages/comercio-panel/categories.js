// Menú → Categorías: agregar, renombrar, ordenar (como aparecen en la tienda), ocultar y borrar.
import { db } from '../../firebase.js';
import { collection, getDocs, doc, setDoc, updateDoc, deleteDoc, query, orderBy, writeBatch } from 'firebase/firestore';
import { loadPanelCatalog } from '../../utils/panel-catalog.js';
import { getRouteParams } from '../../router.js';
import { showToast } from '../../components/toast.js';
import { icon } from '../../utils/icons.js';
import { escapeHtml as esc } from '../../utils/escape.js';
import { enterCommercePanel, cpEmpty, cpSkeleton, cpSheet, cpConfirm } from './shell.js';

export async function renderComercioCategories() {
  const comercioId = getRouteParams().id;
  if (!comercioId) return;
  const body = await enterCommercePanel({
    comercioId, tab: 'menu',
    sub: { title: 'Categorías', back: `#/mi-comercio/${comercioId}/products` },
  });
  if (!body) return;

  body.innerHTML = `
    <div class="cp-page" id="cp-cats">
      <p class="cp-muted" style="margin:0 2px 12px">Así se agrupan tus productos en la tienda, en este orden. Las ocultas no se ven.</p>
      <div id="cp-cats-list">${cpSkeleton(4, 58)}</div>
      <button type="button" class="cp-btn is-red is-block" data-act="add">${icon('plus', 18)} Nueva categoría</button>
    </div>`;
  const root = body.querySelector('#cp-cats');
  const listEl = root.querySelector('#cp-cats-list');
  let cats = [];
  let countBy = {};

  const load = async () => {
    try {
      const [cSnap, prods] = await Promise.all([
        getDocs(query(collection(db, 'comercios', comercioId, 'categories'), orderBy('order'))),
        loadPanelCatalog(comercioId),
      ]);
      cats = cSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      countBy = {};
      prods.forEach(p => { const c = p.categoryId; if (c) countBy[c] = (countBy[c] || 0) + 1; });
      paint();
    } catch (e) {
      console.error('Categorías:', e);
      listEl.innerHTML = cpEmpty('alertTriangle', 'No pudimos cargar las categorías', 'Revisá la conexión y volvé a entrar.');
    }
  };

  const paint = () => {
    if (!cats.length) {
      listEl.innerHTML = cpEmpty('list', 'Todavía no hay categorías', 'Por ejemplo: Pizzas, Empanadas, Bebidas.');
      return;
    }
    listEl.innerHTML = `<div class="cp-list">${cats.map((c, i) => `
      <div class="cp-item" style="cursor:default; gap:8px">
        <span style="display:flex; flex-direction:column; gap:2px">
          <button type="button" class="cp-btn is-sm is-ghost" data-up="${i}" aria-label="Subir ${esc(c.name)}" ${i === 0 ? 'disabled' : ''} style="min-height:26px; padding:0 6px">${icon('chevronUp', 16)}</button>
          <button type="button" class="cp-btn is-sm is-ghost" data-down="${i}" aria-label="Bajar ${esc(c.name)}" ${i === cats.length - 1 ? 'disabled' : ''} style="min-height:26px; padding:0 6px">${icon('chevronDown', 16)}</button>
        </span>
        <button type="button" class="cp-grow" data-edit="${c.id}" style="background:none;border:0;padding:0;text-align:left;cursor:pointer;color:inherit;font:inherit">
          <span class="cp-item-title" style="${c.isActive === false ? 'color:var(--go-text-3)' : ''}">${esc(c.name)}</span>
          <span class="cp-item-sub" style="display:block">${countBy[c.id] || 0} producto${countBy[c.id] === 1 ? '' : 's'}${c.isActive === false ? ' · oculta' : ''}</span>
        </button>
        <button type="button" class="cp-switch" role="switch" aria-label="Mostrar ${esc(c.name)}" aria-checked="${c.isActive !== false}" data-toggle="${c.id}"></button>
      </div>`).join('')}</div>`;
  };

  const askName = (title, value = '') => new Promise((resolve) => {
    let done = false;
    const sheet = cpSheet({
      title,
      bodyHtml: `<input class="cp-input" id="cp-cat-name" maxlength="40" placeholder="Bebidas" value="${esc(value)}" />
                 <p class="cp-small" id="cp-cat-err" style="color:var(--go-red); margin:6px 2px 0" hidden>Escribí un nombre.</p>`,
      actions: [
        { label: 'Cancelar', cls: 'is-ghost' },
        { label: 'Guardar', cls: 'is-ink', onClick: (el) => {
          const v = el.querySelector('#cp-cat-name').value.trim();
          if (!v) { el.querySelector('#cp-cat-err').hidden = false; return false; }
          done = true; resolve(v);
        } },
      ],
      onClose: () => { if (!done) resolve(null); },
    });
    const input = sheet.el.querySelector('#cp-cat-name');
    input.addEventListener('input', () => { sheet.el.querySelector('#cp-cat-err').hidden = true; });
    setTimeout(() => input.focus(), 250);
  });

  const saveOrder = async () => {
    const batch = writeBatch(db);
    cats.forEach((c, i) => { c.order = i; batch.update(doc(db, 'comercios', comercioId, 'categories', c.id), { order: i }); });
    await batch.commit();
  };

  root.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-act],[data-up],[data-down],[data-edit],[data-toggle]');
    if (!t) return;
    const d = t.dataset;
    try {
      if (d.act === 'add') {
        const name = await askName('Nueva categoría');
        if (!name) return;
        const ref = doc(collection(db, 'comercios', comercioId, 'categories'));
        const data = { name, order: cats.length, isActive: true };
        await setDoc(ref, data);
        cats.push({ id: ref.id, ...data });
        paint();
        showToast('Categoría creada', 'success');
      } else if (d.up !== undefined || d.down !== undefined) {
        const i = Number(d.up ?? d.down);
        const j = d.up !== undefined ? i - 1 : i + 1;
        if (j < 0 || j >= cats.length) return;
        [cats[i], cats[j]] = [cats[j], cats[i]];
        paint();
        await saveOrder();
      } else if (d.toggle) {
        const c = cats.find(x => x.id === d.toggle);
        const next = c.isActive === false;
        await updateDoc(doc(db, 'comercios', comercioId, 'categories', c.id), { isActive: next });
        c.isActive = next;
        paint();
      } else if (d.edit) {
        const c = cats.find(x => x.id === d.edit);
        cpSheet({
          title: c.name,
          sub: `${countBy[c.id] || 0} producto(s) en esta categoría.`,
          actions: [
            { label: 'Cambiar nombre', cls: 'is-ink', onClick: async () => {
              const name = await askName('Cambiar nombre', c.name);
              if (!name || name === c.name) return;
              await updateDoc(doc(db, 'comercios', comercioId, 'categories', c.id), { name });
              c.name = name; paint(); showToast('Nombre cambiado', 'success');
            } },
            { label: 'Borrar categoría', cls: 'is-danger', onClick: async () => {
              const n = countBy[c.id] || 0;
              const ok = await cpConfirm({
                title: `¿Borrar "${c.name}"?`,
                message: n ? `Sus ${n} producto(s) no se borran: quedan "sin categoría" y los podés mover editándolos.` : 'No tiene productos.',
                confirmText: 'Borrar', danger: true,
              });
              if (!ok) return;
              await deleteDoc(doc(db, 'comercios', comercioId, 'categories', c.id));
              cats = cats.filter(x => x.id !== c.id);
              paint(); showToast('Categoría borrada', 'info');
            } },
            { label: 'Cerrar', cls: 'is-ghost' },
          ],
        });
      }
    } catch (err) {
      console.error(err);
      showToast('No se pudo guardar. Probá de nuevo.', 'error');
      load();
    }
  });

  load();
}
