// Pestaña Promos: todo lo que sirve para vender más, en un solo lugar.
// Arriba "¿Qué querés hacer?" y abajo las promos que ya tenés, con su interruptor.
// (La publicidad paga todavía no está habilitada para los comercios.)
import { db } from '../../firebase.js';
import { collection, getDocs, query, where, doc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { getRouteParams } from '../../router.js';
import { icon } from '../../utils/icons.js';
import { escapeHtml as esc } from '../../utils/escape.js';
import { showToast } from '../../components/toast.js';
import { enterCommercePanel, getPanelComercio, cpEmpty, cpSkeleton, cpSheet, cpConfirm } from './shell.js';

const expiryMs = (v) => {
  if (!v) return 0;
  if (v.toMillis) return v.toMillis();
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? 0 : t;
};

function couponState(c) {
  const exp = expiryMs(c.expirationDate);
  if (exp && exp < Date.now()) return { key: 'expired', label: 'Vencido', cls: '' };
  if (c.usageLimit && (c.usedCount || 0) >= c.usageLimit) return { key: 'used', label: 'Agotado', cls: '' };
  return c.active === false ? { key: 'off', label: 'Pausado', cls: 'is-amber' } : { key: 'on', label: 'Activo', cls: 'is-green' };
}

export async function renderComercioPromos() {
  const comercioId = getRouteParams().id;
  if (!comercioId) return;
  const body = await enterCommercePanel({ comercioId, tab: 'promos' });
  if (!body) return;

  body.innerHTML = `
    <div class="cp-page" id="cp-promos">
      <h2 class="cp-h2" style="margin-top:4px">¿Qué querés hacer?</h2>
      <div class="cp-list">
        <button class="cp-item" type="button" data-new="combo">
          <span class="cp-item-icon is-red">${icon('gift', 20)}</span>
          <span class="cp-grow"><span class="cp-item-title">Armar un combo</span><span class="cp-item-sub" style="display:block">Fernet + Coca, vino + gaseosa… Elegís qué incluye y se ve primero en tu tienda.</span></span>
          <span class="cp-chev">${icon('chevronRight', 18)}</span>
        </button>
        <button class="cp-item" type="button" data-new="offer">
          <span class="cp-item-icon is-red">${icon('percent', 20)}</span>
          <span class="cp-grow"><span class="cp-item-title">Descuento en productos</span><span class="cp-item-sub" style="display:block">2x1 o un % menos en los que elijas. Se ve en la app.</span></span>
          <span class="cp-chev">${icon('chevronRight', 18)}</span>
        </button>
        <button class="cp-item" type="button" data-new="coupon">
          <span class="cp-item-icon">${icon('ticket', 20)}</span>
          <span class="cp-grow"><span class="cp-item-title">Código de cupón</span><span class="cp-item-sub" style="display:block">Un código para tus clientes de siempre o tus redes.</span></span>
          <span class="cp-chev">${icon('chevronRight', 18)}</span>
        </button>
        <button class="cp-item" type="button" data-new="share">
          <span class="cp-item-icon">${icon('whatsapp', 20)}</span>
          <span class="cp-grow"><span class="cp-item-title">Compartir mi catálogo</span><span class="cp-item-sub" style="display:block">Link directo y QR: pedidos sin competencia y sin comisión de app.</span></span>
          <span class="cp-chev">${icon('chevronRight', 18)}</span>
        </button>
      </div>
      <h2 class="cp-h2">Tus promos</h2>
      <div id="cp-promos-list">${cpSkeleton(2, 72)}</div>
    </div>`;

  const root = body.querySelector('#cp-promos');
  const listEl = root.querySelector('#cp-promos-list');
  let offers = [];
  let coupons = [];
  let combos = [];

  const load = async () => {
    try {
      const [oSnap, cSnap] = await Promise.all([
        getDocs(query(collection(db, 'offers'), where('comercioId', '==', comercioId))),
        getDocs(query(collection(db, 'coupons'), where('ownerId', '==', comercioId))),
      ]);
      offers = oSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      combos = await import('./combos.js').then(m => m.loadCombos(comercioId)).catch(() => []);
      coupons = cSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      paint();
    } catch (e) {
      console.error('Promos:', e);
      listEl.innerHTML = cpEmpty('alertTriangle', 'No pudimos cargar tus promos', 'Revisá la conexión y volvé a entrar.');
    }
  };

  const paint = () => {
    if (!offers.length && !coupons.length && !combos.length) {
      listEl.innerHTML = cpEmpty('percent', 'Todavía no tenés promos', 'Un 2x1 los días flojos o un cupón para tus clientes ayudan a vender más.');
      return;
    }
    const offerRow = (o) => `
      <div class="cp-item" style="cursor:default">
        <span class="cp-item-icon is-red">${icon('percent', 20)}</span>
        <button type="button" class="cp-grow" data-edit-offer="${o.id}" style="background:none;border:0;padding:0;text-align:left;cursor:pointer;color:inherit;font:inherit">
          <span class="cp-item-title">${esc(o.title || 'Oferta')}</span>
          <span class="cp-item-sub" style="display:block">${o.type === '2x1' ? '2x1' : `${o.value || 0}% menos`} · ${(o.productIds || []).length} producto${(o.productIds || []).length === 1 ? '' : 's'}</span>
        </button>
        <button type="button" class="cp-switch" role="switch" aria-label="Activar oferta" aria-checked="${o.active !== false}" data-toggle-offer="${o.id}"></button>
      </div>`;
    const couponRow = (c) => {
      const st = couponState(c);
      const exp = expiryMs(c.expirationDate);
      return `
      <div class="cp-item" style="cursor:default">
        <span class="cp-item-icon">${icon('ticket', 20)}</span>
        <button type="button" class="cp-grow" data-coupon="${esc(c.id)}" style="background:none;border:0;padding:0;text-align:left;cursor:pointer;color:inherit;font:inherit">
          <span class="cp-item-title">${esc(c.id)} <span class="cp-tag ${st.cls}" style="margin-left:4px">${st.label}</span></span>
          <span class="cp-item-sub" style="display:block">${c.type === 'percentage' ? `${c.value}% menos` : `$${Number(c.value || 0).toLocaleString('es-AR')} menos`} · usado ${c.usedCount || 0}${c.usageLimit ? ` de ${c.usageLimit}` : ''}${exp ? ` · vence ${new Date(exp).toLocaleDateString('es-AR')}` : ''}</span>
        </button>
        ${st.key === 'on' || st.key === 'off' ? `<button type="button" class="cp-switch" role="switch" aria-label="Activar cupón" aria-checked="${st.key === 'on'}" data-toggle-coupon="${esc(c.id)}"></button>` : ''}
      </div>`;
    };
    const comboRow = (c) => {
      const on = c.isAvailable !== false && c.hiddenInGo !== true;
      const img = c.image || (c.comboItems || []).find(x => x.image)?.image || '';
      return `
      <div class="cp-item" style="cursor:default">
        ${img ? `<img src="${esc(img)}" alt="" style="width:42px;height:42px;border-radius:12px;object-fit:contain;background:#fff;border:1px solid var(--go-line);flex-shrink:0" />` : `<span class="cp-item-icon is-red">${icon('gift', 20)}</span>`}
        <button type="button" class="cp-grow" data-edit-combo="${esc(c.id)}" style="background:none;border:0;padding:0;text-align:left;cursor:pointer;color:inherit;font:inherit">
          <span class="cp-item-title">${esc(c.name || 'Combo')}</span>
          <span class="cp-item-sub" style="display:block">$${Number(c.price || 0).toLocaleString('es-AR')} · incluye ${(c.comboItems || []).length} producto${(c.comboItems || []).length === 1 ? '' : 's'}</span>
        </button>
        <button type="button" class="cp-switch" role="switch" aria-label="Mostrar combo" aria-checked="${on}" data-toggle-combo="${esc(c.id)}"></button>
      </div>`;
    };
    listEl.innerHTML = `
      ${combos.length ? `<div class="cp-list">${combos.map(comboRow).join('')}</div>` : ''}
      ${offers.length ? `<div class="cp-list">${offers.map(offerRow).join('')}</div>` : ''}
      ${coupons.length ? `<div class="cp-list">${coupons.sort((a, b) => (couponState(a).key === 'on' ? -1 : 1) - (couponState(b).key === 'on' ? -1 : 1)).map(couponRow).join('')}</div>` : ''}
      <p class="cp-small" style="text-align:center">Tocá una promo para editarla o borrarla.</p>`;
  };

  root.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-new],[data-toggle-offer],[data-toggle-coupon],[data-edit-offer],[data-coupon],[data-edit-combo],[data-toggle-combo]');
    if (!t) return;
    const d = t.dataset;
    const name = getPanelComercio()?.name || '';

    if (d.new === 'combo' || d.editCombo) {
      const { openComboEditor } = await import('./combos.js');
      openComboEditor(comercioId, getPanelComercio(), d.editCombo ? combos.find(x => x.id === d.editCombo) : null, load);
    } else if (d.toggleCombo) {
      const c = combos.find(x => x.id === d.toggleCombo);
      const next = !(c.isAvailable !== false && c.hiddenInGo !== true);
      t.setAttribute('aria-checked', String(next));
      try {
        // hiddenInGo: aunque la caja lo vuelva a mandar, queda oculto hasta que lo prendas acá
        await updateDoc(doc(db, 'comercios', comercioId, 'products', c.id), { isAvailable: next, hiddenInGo: !next, updatedAt: serverTimestamp() });
        c.isAvailable = next; c.hiddenInGo = !next;
        showToast(next ? 'Combo a la venta' : 'Combo oculto', next ? 'success' : 'info');
      } catch (err) { t.setAttribute('aria-checked', String(!next)); showToast('No se pudo cambiar. Probá de nuevo.', 'error'); }
    } else if (d.new === 'offer') {
      const { openOfferEditorFor } = await import('./offers.js');
      openOfferEditorFor(comercioId, name, null, load);
    } else if (d.new === 'coupon') {
      const { openCouponCreator } = await import('./coupons.js');
      openCouponCreator(comercioId, name, load);
    } else if (d.new === 'share') {
      const { openWhatsAppCatalogModal } = await import('../../components/whatsapp-catalog-modal.js');
      openWhatsAppCatalogModal(comercioId, getPanelComercio());
    } else if (d.toggleOffer) {
      const o = offers.find(x => x.id === d.toggleOffer);
      const next = o.active === false;
      t.setAttribute('aria-checked', String(next));
      try {
        await updateDoc(doc(db, 'offers', o.id), { active: next });
        o.active = next;
        showToast(next ? 'Oferta activada' : 'Oferta pausada', next ? 'success' : 'info');
      } catch (err) { t.setAttribute('aria-checked', String(!next)); showToast('No se pudo cambiar. Probá de nuevo.', 'error'); }
    } else if (d.toggleCoupon) {
      const c = coupons.find(x => x.id === d.toggleCoupon);
      const next = c.active === false;
      t.setAttribute('aria-checked', String(next));
      try {
        await updateDoc(doc(db, 'coupons', c.id), { active: next });
        c.active = next;
        paint();
        showToast(next ? 'Cupón activado' : 'Cupón pausado', next ? 'success' : 'info');
      } catch (err) { t.setAttribute('aria-checked', String(!next)); showToast('No se pudo cambiar. Probá de nuevo.', 'error'); }
    } else if (d.editOffer) {
      const o = offers.find(x => x.id === d.editOffer);
      cpSheet({
        title: o.title || 'Oferta',
        sub: `${o.type === '2x1' ? '2x1' : `${o.value || 0}% menos`} en ${(o.productIds || []).length} producto(s).`,
        actions: [
          { label: 'Editar', cls: 'is-ink', onClick: async () => { const { openOfferEditorFor } = await import('./offers.js'); openOfferEditorFor(comercioId, name, o, load); } },
          { label: 'Borrar oferta', cls: 'is-danger', onClick: async () => {
            if (!(await cpConfirm({ title: '¿Borrar esta oferta?', message: 'Deja de verse en la app. No se puede deshacer.', confirmText: 'Borrar', danger: true }))) return;
            await deleteDoc(doc(db, 'offers', o.id)); showToast('Oferta borrada', 'info'); load();
          } },
          { label: 'Cerrar', cls: 'is-ghost' },
        ],
      });
    } else if (d.coupon) {
      const c = coupons.find(x => x.id === d.coupon);
      cpSheet({
        title: `Cupón ${c.id}`,
        sub: `Usado ${c.usedCount || 0}${c.usageLimit ? ` de ${c.usageLimit}` : ''} veces. El código no se puede cambiar: si querés otro, creá uno nuevo.`,
        actions: [
          { label: 'Copiar código', cls: 'is-ink', onClick: async () => { try { await navigator.clipboard.writeText(c.id); showToast('Código copiado', 'success'); } catch (err) { showToast(c.id, 'info'); } } },
          { label: 'Borrar cupón', cls: 'is-danger', onClick: async () => {
            if (!(await cpConfirm({ title: '¿Borrar este cupón?', message: 'Quien lo tenga ya no lo va a poder usar.', confirmText: 'Borrar', danger: true }))) return;
            await deleteDoc(doc(db, 'coupons', c.id)); showToast('Cupón borrado', 'info'); load();
          } },
          { label: 'Cerrar', cls: 'is-ghost' },
        ],
      });
    }
  });

  load();
}
