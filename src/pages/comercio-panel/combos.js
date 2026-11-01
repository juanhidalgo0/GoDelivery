// Panel del comercio → Promos → "Armar un combo". Un combo es un producto con lo que incluye
// (isCombo, comboItems, comboRegularPrice) y va al rubro "Promos", que la tienda muestra primero.
// Si el pedido lo compra el repartidor, el combo tiene que ser una promo que ya existe en la caja del
// kiosco (el repartidor la pide por ese nombre y la paga a ese precio): se elige ese producto y se
// marca qué incluye. En los demás comercios se arma con nombre y precio propios.
import { db } from '../../firebase.js';
import { collection, getDocs, query, where, limit, doc, updateDoc, addDoc, deleteDoc, deleteField, serverTimestamp } from 'firebase/firestore';
import { showModal, closeModal } from '../../components/modal.js';
import { showToast } from '../../components/toast.js';
import { icon } from '../../utils/icons.js';
import { escapeHtml as esc } from '../../utils/escape.js';
import { formatPrice } from '../../utils/format.js';
import { searchTokens, buildSearchKeys } from '../../utils/search-keys.js';
import { displayName } from '../../utils/product-name.js';
import { cpConfirm } from './shell.js';
import '../../styles/combos.css';

const usesRegisterPromo = (c) => c?.fulfillmentMode === 'shopper' || c?.ventraLinked === true;

/** Los combos del comercio (para la lista de Promos) */
export async function loadCombos(comercioId) {
  const snap = await getDocs(query(collection(db, 'comercios', comercioId, 'products'), where('isCombo', '==', true)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** Rubro "Promos" (arriba de todo); se crea si no está */
async function promosCategoryId(comercioId) {
  const snap = await getDocs(collection(db, 'comercios', comercioId, 'categories'));
  const found = snap.docs.find((d) => !d.data().parentCategoryId && String(d.data().name || '').trim().toLowerCase() === 'promos');
  if (found) {
    if (found.data().isActive === false || found.data().order !== -1) await updateDoc(found.ref, { isActive: true, order: -1 });
    return found.id;
  }
  const ref = await addDoc(collection(db, 'comercios', comercioId, 'categories'), { name: 'Promos', order: -1, isActive: true, source: 'go', createdAt: serverTimestamp() });
  return ref.id;
}

/** Busca productos: en catálogos grandes por palabras (searchKeys), en los chicos entre todos */
function productSearcher(comercioId) {
  let all = null;
  let big = false;
  const ready = getDocs(query(collection(db, 'comercios', comercioId, 'products'), limit(401))).then((s) => {
    big = s.size > 400;
    all = big ? [] : s.docs.map((d) => ({ id: d.id, ...d.data() }));
  });
  const cache = new Map();
  return async (text) => {
    await ready;
    const tokens = searchTokens(text).filter(Boolean);
    if (!tokens.length) return [];
    let pool = all;
    if (big) {
      const key = tokens.slice().sort((a, b) => b.length - a.length)[0].slice(0, 10);
      if (key.length < 2) return [];
      if (!cache.has(key)) {
        const s = await getDocs(query(collection(db, 'comercios', comercioId, 'products'), where('searchKeys', 'array-contains', key), limit(80)));
        cache.set(key, s.docs.map((d) => ({ id: d.id, ...d.data() })));
      }
      pool = cache.get(key);
    }
    return pool.filter((p) => {
      const words = searchTokens(p.name);
      return tokens.every((t) => words.some((w) => w.startsWith(t))) || (tokens.length === 1 && String(p.barcode || '').toLowerCase() === tokens[0]);
    }).sort((a, b) => (b.popularity || 0) - (a.popularity || 0)).slice(0, 30);
  };
}

/**
 * Editor de combo. existing: el producto-combo a editar (o null para uno nuevo).
 * onSaved: se llama al guardar o sacar el combo.
 */
export function openComboEditor(comercioId, comercio, existing = null, onSaved = null) {
  const fromRegister = usesRegisterPromo(comercio);
  const search = productSearcher(comercioId);
  let base = existing && fromRegister ? existing : null;
  let items = Array.isArray(existing?.comboItems) ? existing.comboItems.map((x) => ({ ...x })) : [];
  let name = existing ? displayName(existing.name) : '';
  let price = existing && !fromRegister ? existing.price : '';
  let image = existing?.image || '';
  let picking = fromRegister && !base ? 'base' : 'items';

  const el = document.createElement('div');
  el.className = 'cb';
  showModal({ title: '', hideHeader: true, fullscreen: true, content: el });

  const regular = () => items.reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.qty) || 1), 0);
  const finalPrice = () => (fromRegister ? Number(base?.price) || 0 : Number(price) || 0);

  function collage(list) {
    const imgs = list.map((x) => x.image).filter(Boolean).slice(0, 3);
    if (!imgs.length) return `<div class="cb-collage">${icon('gift', 26)}</div>`;
    return `<div class="cb-collage is-${imgs.length}">${imgs.map((src) => `<img src="${esc(src)}" alt="" />`).join('')}</div>`;
  }

  function paint() {
    const save = finalPrice();
    const reg = regular();
    el.innerHTML = `
      <header class="cb-top">
        <button class="cb-icon" data-act="close" aria-label="Cerrar">${icon('close', 20)}</button>
        <h2>${existing ? 'Editar combo' : 'Armar un combo'}</h2>
        <span></span>
      </header>
      <div class="cb-body">
        <div class="cb-preview">
          ${(image || base?.image) ? `<img class="cb-photo" src="${esc(image || base.image)}" alt="" />` : collage(items)}
          <div>
            <div class="cb-preview-name">${esc(name || 'Tu combo')}</div>
            <div class="cb-preview-price">${save ? formatPrice(save) : '$ —'}${reg > save && save ? `<s>${formatPrice(reg)}</s>` : ''}</div>
            ${reg > save && save ? `<span class="cb-save">Ahorran ${formatPrice(reg - save)}</span>` : ''}
          </div>
        </div>

        ${fromRegister ? `
          <section class="cb-step">
            <div class="cb-step-head"><span>1</span><div><b>¿Qué promo de la caja es?</b><small>El repartidor la pide en el mostrador por ese nombre y la paga a ese precio.</small></div></div>
            ${base ? `<div class="cb-picked">${collage([base])}<div><b>${esc(displayName(base.name))}</b><small>${formatPrice(base.price)}${base.barcode ? ` · código ${esc(base.barcode)}` : ''}</small></div>${existing ? '' : `<button data-act="change-base">Cambiar</button>`}</div>`
            : `<label class="cb-search">${icon('search', 17)}<input id="cb-q-base" placeholder="Buscá la promo: por ejemplo “promo” o su código" autocomplete="off" /></label><div class="cb-results" id="cb-res-base"></div>`}
          </section>` : ''}

        <section class="cb-step ${fromRegister && !base ? 'is-dim' : ''}">
          <div class="cb-step-head"><span>${fromRegister ? 2 : 1}</span><div><b>¿Qué incluye?</b><small>Buscá cada producto y elegí cuántos van.</small></div></div>
          ${items.length ? `<div class="cb-items">${items.map((it, i) => `
            <div class="cb-item">
              <img src="${esc(it.image || '/logo.png')}" alt="" />
              <div class="cb-item-text"><b>${esc(displayName(it.name))}</b><small>${formatPrice(it.price || 0)} c/u</small></div>
              <div class="cb-qty"><button data-act="dec" data-i="${i}" aria-label="Uno menos">${it.qty > 1 ? icon('minus', 15) : icon('trash', 14)}</button><span>${it.qty}</span><button data-act="inc" data-i="${i}" aria-label="Uno más">${icon('plus', 15)}</button></div>
            </div>`).join('')}</div>` : ''}
          <label class="cb-search">${icon('plus', 17)}<input id="cb-q-items" placeholder="Agregar un producto" autocomplete="off" ${fromRegister && !base ? 'disabled' : ''} /></label>
          <div class="cb-results" id="cb-res-items"></div>
        </section>

        <section class="cb-step">
          <div class="cb-step-head"><span>${fromRegister ? 3 : 2}</span><div><b>Cómo se ve en la app</b><small>${fromRegister ? 'El precio sale de la caja.' : 'Nombre y precio del combo.'}</small></div></div>
          <label class="cb-field"><span>Nombre</span><input id="cb-name" value="${esc(name)}" placeholder="Ej: Fernet + Coca" maxlength="80" /></label>
          ${fromRegister ? '' : `<label class="cb-field"><span>Precio del combo</span><input id="cb-price" type="number" inputmode="decimal" min="0" value="${esc(price)}" placeholder="0" /></label>`}
          <label class="cb-field"><span>Foto (link, opcional)</span><input id="cb-image" value="${esc(image)}" placeholder="Si no ponés una, se arma con las fotos de lo que incluye" /></label>
        </section>
      </div>
      <footer class="cb-foot">
        ${existing ? `<button class="cb-btn is-ghost" data-act="remove">${fromRegister ? 'Dejar de ser combo' : 'Borrar combo'}</button>` : ''}
        <button class="cb-btn" data-act="save">${existing ? 'Guardar cambios' : 'Crear combo'}</button>
      </footer>`;
    bind();
  }

  function resultsHtml(list, kind) {
    if (!list.length) return '<div class="cb-none">No encontramos productos con eso.</div>';
    return list.map((p) => `<button class="cb-res" data-pick="${kind}" data-id="${esc(p.id)}">
      <img src="${esc(p.image || '/logo.png')}" alt="" /><span><b>${esc(displayName(p.name))}</b><small>${formatPrice(p.price || 0)}${p.isAvailable === false ? ' · no está a la venta' : ''}</small></span>${icon(kind === 'base' ? 'chevronRight' : 'plus', 16)}
    </button>`).join('');
  }

  let found = { base: [], items: [] };
  function bind() {
    [['base', 'cb-q-base', 'cb-res-base'], ['items', 'cb-q-items', 'cb-res-items']].forEach(([kind, inputId, resId]) => {
      const input = el.querySelector(`#${inputId}`);
      if (!input) return;
      let t = null;
      input.addEventListener('input', () => {
        clearTimeout(t);
        const q = input.value;
        t = setTimeout(async () => {
          const res = el.querySelector(`#${resId}`);
          if (!q.trim()) { res.innerHTML = ''; return; }
          res.innerHTML = '<div class="cb-none">Buscando…</div>';
          try {
            found[kind] = (await search(q)).filter((p) => !p.isCombo || kind === 'base').filter((p) => kind !== 'items' || p.id !== base?.id);
            res.innerHTML = resultsHtml(found[kind], kind);
          } catch (e) { res.innerHTML = '<div class="cb-none">No se pudo buscar. Revisá la conexión.</div>'; }
        }, 250);
      });
      if (picking === kind) setTimeout(() => input.focus(), 50);
    });
    ['cb-name', 'cb-price', 'cb-image'].forEach((id) => el.querySelector(`#${id}`)?.addEventListener('input', (e) => {
      if (id === 'cb-name') name = e.target.value;
      if (id === 'cb-price') price = e.target.value;
      if (id === 'cb-image') image = e.target.value.trim();
      const prev = el.querySelector('.cb-preview');
      if (prev && id !== 'cb-image') {
        prev.querySelector('.cb-preview-name').textContent = name || 'Tu combo';
        const save = finalPrice(); const reg = regular();
        prev.querySelector('.cb-preview-price').innerHTML = `${save ? formatPrice(save) : '$ —'}${reg > save && save ? `<s>${formatPrice(reg)}</s>` : ''}`;
      }
    }));
    ['cb-name', 'cb-price', 'cb-image'].forEach((id) => el.querySelector(`#${id}`)?.addEventListener('change', paint));
  }

  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act],[data-pick]');
    if (!b) return;
    const act = b.dataset.act;
    if (b.dataset.pick) {
      const p = found[b.dataset.pick].find((x) => x.id === b.dataset.id);
      if (!p) return;
      if (b.dataset.pick === 'base') {
        base = p;
        if (!name) name = displayName(p.name);
        items = Array.isArray(p.comboItems) ? p.comboItems.map((x) => ({ ...x })) : items;
        picking = 'items';
      } else {
        const have = items.find((x) => x.productId === p.id);
        if (have) have.qty += 1;
        else items.push({ productId: p.id, name: p.name, qty: 1, image: p.image || '', price: Number(p.price) || 0 });
        picking = 'items';
      }
      paint();
      return;
    }
    if (act === 'close') { closeModal(); return; }
    if (act === 'change-base') { base = null; picking = 'base'; paint(); return; }
    if (act === 'inc' || act === 'dec') {
      const it = items[Number(b.dataset.i)];
      if (!it) return;
      it.qty += act === 'inc' ? 1 : -1;
      if (it.qty <= 0) items.splice(Number(b.dataset.i), 1);
      paint();
      return;
    }
    if (act === 'remove') {
      const ok = await cpConfirm({
        title: fromRegister ? '¿Dejar de mostrarlo como combo?' : '¿Borrar este combo?',
        message: fromRegister ? 'El producto sigue a la venta como siempre, pero sin la lista de lo que incluye.' : 'Deja de verse en la app. No se puede deshacer.',
        confirmText: fromRegister ? 'Sí, sacar' : 'Borrar', danger: true,
      });
      if (!ok) return;
      try {
        const ref = doc(db, 'comercios', comercioId, 'products', existing.id);
        if (fromRegister) await updateDoc(ref, { isCombo: false, comboItems: deleteField(), comboRegularPrice: deleteField(), updatedAt: serverTimestamp() });
        else await deleteDoc(ref);
        showToast(fromRegister ? 'Ya no es un combo' : 'Combo borrado', 'info');
        closeModal();
        onSaved && onSaved();
      } catch (err) { showToast('No se pudo. Probá de nuevo.', 'error'); }
      return;
    }
    if (act === 'save') {
      name = (el.querySelector('#cb-name')?.value || name).trim();
      if (fromRegister && !base) { showToast('Elegí qué promo de la caja es.', 'warning'); return; }
      if (!items.length) { showToast('Agregá lo que incluye el combo.', 'warning'); return; }
      if (!name) { showToast('Poné un nombre para el combo.', 'warning'); return; }
      if (!fromRegister && !(Number(price) > 0)) { showToast('Poné el precio del combo.', 'warning'); return; }
      b.disabled = true;
      b.textContent = 'Guardando…';
      try {
        const categoryId = await promosCategoryId(comercioId);
        const comboItems = items.map((x) => ({ productId: x.productId, name: x.name, qty: Number(x.qty) || 1, image: x.image || '', price: Number(x.price) || 0 }));
        const common = {
          updatedAt: serverTimestamp(),
          isCombo: true, comboItems, comboRegularPrice: regular(), categoryId, updatedAt: serverTimestamp(),
          ...(image ? { image } : {}),
          description: `Incluye: ${comboItems.map((x) => `${x.qty > 1 ? `${x.qty} ` : ''}${displayName(x.name)}`).join(' + ')}`,
        };
        if (fromRegister) {
          const nameChanged = name !== displayName(base.name);
          await updateDoc(doc(db, 'comercios', comercioId, 'products', base.id), {
            ...common,
            ...(nameChanged ? { name, nameLockedInGo: true, searchKeys: buildSearchKeys(name, base.barcode) } : {}),
          });
        } else if (existing) {
          await updateDoc(doc(db, 'comercios', comercioId, 'products', existing.id), { ...common, name, price: Number(price), searchKeys: buildSearchKeys(name) });
        } else {
          await addDoc(collection(db, 'comercios', comercioId, 'products'), {
            ...common, name, price: Number(price), image: image || '', isAvailable: true, stockMode: 'unlimited',
            optionsGroups: [], order: 0, source: 'go-combo', searchKeys: buildSearchKeys(name), createdAt: serverTimestamp(),
          });
        }
        showToast(existing ? 'Combo guardado' : 'Combo creado: ya se ve primero en tu tienda', 'success');
        closeModal();
        onSaved && onSaved();
      } catch (err) {
        console.error('Combo:', err);
        showToast('No se pudo guardar. Probá de nuevo.', 'error');
        b.disabled = false;
        b.textContent = existing ? 'Guardar cambios' : 'Crear combo';
      }
    }
  });

  paint();
}
