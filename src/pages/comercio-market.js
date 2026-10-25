// GoDelivery — Tienda tipo mercado (kioscos, almacenes y comercios de Ventra con miles de productos).
// Los restaurantes siguen con la tienda de comercio.js. Acá: portada con rubros, "Lo más vendido",
// "Volver a pedir", una fila por rubro; tarjetas con foto arriba y "– 2 +"; buscador que busca en todo
// el catálogo (searchKeys, sin bajar miles de productos) y "Combiná con…" al agregar.
import { db } from '../firebase.js';
import { collection, query, where, limit, orderBy, documentId } from 'firebase/firestore';
import { addToCart, updateCartQty, getState, setState, subscribe } from '../state.js';
import { getDocsOptimized } from '../utils/firestore-cache.js';
import { formatPrice, isShopOpen } from '../utils/format.js';
import { showToast } from '../components/toast.js';
import { renderNavbar, updateGlobalCartFAB } from '../components/navbar.js';
import { openProductModal } from '../components/product-modal.js';
import { icon } from '../utils/icons.js';
import { escapeHtml as esc } from '../utils/escape.js';
import { isSoldByWeight } from '../utils/weight.js';
import { searchTokens } from '../utils/search-keys.js';
import { displayName } from '../utils/product-name.js';
import '../styles/market.css';

const MARKET_CATEGORIES = ['kiosco', 'almacén', 'almacen', 'supermercado', 'autoservicio', 'despensa', 'maxikiosco'];
const ADULT = ['cervezas', 'vinos y bebidas blancas', 'cigarrillos', 'tabacos'];
const COLD = ['cervezas', 'bebidas', 'helados y congelados'];
const NOT_COLD = ['jugos en polvo'];
const HIDE_IN_TOP = ['cigarrillos', 'tabacos', 'medicamentos'];
const BIG_CATALOG = 400;
const PAGE = 60;

/** Tiendas que se muestran como mercado: las que arma el repartidor, las de Ventra y los rubros de kiosco */
export function isMarketStore(comercio) {
  if (!comercio) return false;
  if (comercio.fulfillmentMode === 'shopper' || comercio.ventraLinked === true) return true;
  const cats = [comercio.category, ...(Array.isArray(comercio.categories) ? comercio.categories : [])].map((c) => String(c || '').toLowerCase());
  return cats.some((c) => MARKET_CATEGORIES.includes(c));
}

const isAvailable = (p) => p.isAvailable !== false && !(p.stockMode === 'limited' && (p.stockQuantity || 0) <= 0);
const needsModal = (p) => (p.optionsGroups && p.optionsGroups.length > 0) || p.useGlobalFlavors === true || isSoldByWeight(p);
const toMs = (t) => (t && t.toMillis ? t.toMillis() : (t ? new Date(t).getTime() : 0));

// Distancia de edición acotada (para "cocacola", "fernet branka"): ¿a y b difieren en una letra o menos?
function nearlyEqual(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/** ¿El nombre tiene todas las palabras buscadas? (cada una como comienzo de palabra, o con una letra mal) */
function matches(name, tokens, barcode) {
  if (barcode && tokens.length === 1 && String(barcode) === tokens[0]) return true;
  const words = searchTokens(name);
  return tokens.every((t) => words.some((w) => w.startsWith(t) || (t.length >= 4 && [t.length - 1, t.length, t.length + 1].some((n) => nearlyEqual(w.slice(0, n), t)))));
}

export function mountMarket(content, ctx) {
  const { comercioId, isDirect } = ctx;
  let comercio = ctx.comercio;
  let categories = ctx.categories;
  let offers = ctx.activeOffers || [];
  const products = ctx.products;
  const byId = new Map();
  const index = () => { products.forEach((p) => byId.set(p.id, p)); };
  index();

  let view = { type: 'home' };
  let searchText = '';
  let searchOpen = false;
  let reorderIds = [];
  const loadedCats = new Set();

  // ─── rubros
  const tops = () => categories.filter((c) => !c.parentCategoryId).sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  const subsOf = (topId) => categories.filter((c) => c.parentCategoryId === topId).sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  const catById = (id) => categories.find((c) => c.id === id);
  const topOf = (catId) => { const c = catById(catId); return c ? (c.parentCategoryId ? catById(c.parentCategoryId) : c) : null; };
  const topName = (p) => String(topOf(p.categoryId)?.name || '').toLowerCase();
  const subName = (p) => { const c = catById(p.categoryId); return c && c.parentCategoryId ? String(c.name).toLowerCase() : ''; };
  // Los rubros apagados ya vienen filtrados: los que quedan tienen productos aunque no estén cargados
  const visibleTops = () => tops();

  const offerOf = (p) => offers.find((o) => Array.isArray(o.productIds) && o.productIds.includes(p.id));
  const priceOf = (p) => { const o = offerOf(p); return o && o.type === 'percentage' ? p.price * (1 - (o.value || 0) / 100) : p.price; };
  const byPopularity = (a, b) => (b.popularity || 0) - (a.popularity || 0) || String(a.name).localeCompare(String(b.name));
  // "Más vendido": solo los 12 de arriba de todo el kiosco (si lo tuviera todo, no diría nada)
  const bestThreshold = () => new Set(products.filter((p) => isAvailable(p) && (p.popularity || 0) > 0 && !p.isCombo).sort(byPopularity).slice(0, 12).map((p) => p.id));
  let best = bestThreshold();
  const linkedAt = toMs(comercio.ventraLinkedAt || comercio.createdAt);

  const isOpenNow = () => isShopOpen(comercio.schedules || (comercio.schedule ? [comercio.schedule] : []), comercio.daysOpen, comercio.weeklySchedule);
  const isAdult = (p) => ADULT.includes(topName(p)) || subName(p) === 'vapers';

  // ─── carrito
  const cartLine = (p) => (getState().cart || []).find((i) => i.comercioId === comercioId && i.product?.id === p.id && (!i.options || i.options.length === 0) && !i.notes);
  const qtyOf = (p) => (getState().cart || []).filter((i) => i.comercioId === comercioId && i.product?.id === p.id).reduce((s, i) => s + i.qty, 0);

  // ─── HTML
  // La foto grande (functions/hd-images.js) si la hay; si no, la de la caja
  const photo = (p) => p.imageHd || p.image || '';
  function labelsHtml(p) {
    const out = [];
    const o = offerOf(p);
    if (o) out.push(`<span class="mk-tag is-offer">${o.type === 'percentage' ? `${o.value}% OFF` : esc(o.label || 'Oferta')}</span>`);
    else if (best.has(p.id)) out.push('<span class="mk-tag is-best">Más vendido</span>');
    else if (toMs(p.createdAt) > Date.now() - 14 * 86400000 && toMs(p.createdAt) - linkedAt > 7 * 86400000) out.push('<span class="mk-tag is-new">Nuevo</span>');
    const cold = COLD.includes(topName(p)) && !NOT_COLD.includes(subName(p)) ? '<span class="mk-cold">Frío</span>' : '';
    return (out.length ? `<div class="mk-tags">${out.join('')}</div>` : '') + cold;
  }

  function stepperHtml(p) {
    if (!isAvailable(p)) return '<span class="mk-out">Agotado</span>';
    const q = qtyOf(p);
    if (!q) return `<button class="mk-add" data-act="add" aria-label="Agregar">${icon('plus', 18)}</button>`;
    return `<div class="mk-step"><button data-act="dec" aria-label="Sacar uno">${q === 1 ? icon('trash', 15) : icon('minus', 16)}</button><span>${q}</span><button data-act="inc" aria-label="Agregar otro">${icon('plus', 16)}</button></div>`;
  }

  function cardHtml(p, mini = false) {
    const o = offerOf(p);
    const price = priceOf(p);
    return `<article class="mk-card${mini ? ' is-mini' : ''}${isAvailable(p) ? '' : ' is-out'}" data-pid="${esc(p.id)}">
      <div class="mk-img">
        ${photo(p) ? `<img src="${esc(photo(p))}" alt="" loading="lazy" decoding="async" />` : `<span class="mk-noimg">${icon('shoppingBag', 26)}</span>`}
        ${mini ? '' : labelsHtml(p)}
        <div class="mk-cta">${stepperHtml(p)}</div>
      </div>
      <div class="mk-price">${formatPrice(price)}${isSoldByWeight(p) ? '<small> /kg</small>' : ''}${o ? `<s>${formatPrice(p.price)}</s>` : ''}</div>
      <div class="mk-name">${esc(displayName(p.name))}</div>
    </article>`;
  }

  const railHtml = (id, title, list, more) => list.length < 2 ? '' : `
    <section class="mk-rail" data-rail="${esc(id)}">
      <header><h2>${title}</h2>${more ? `<button class="mk-more" data-go="${esc(more)}">Ver todo ${icon('chevronRight', 14)}</button>` : ''}</header>
      <div class="mk-row-wrap">
        <button class="mk-arrow is-left" data-scroll="-1" aria-label="Anteriores">${icon('chevronLeft', 18)}</button>
        <div class="mk-row">${list.map((p) => cardHtml(p)).join('')}</div>
        <button class="mk-arrow is-right" data-scroll="1" aria-label="Siguientes">${icon('chevronRight', 18)}</button>
      </div>
    </section>`;

  function statusText() {
    if (comercio.isPaused) return '<b class="is-paused">Pausado por un rato</b>';
    const open = isOpenNow();
    const sch = Array.isArray(comercio.schedules) && comercio.schedules[0] ? comercio.schedules[0] : comercio.schedule;
    const hours = sch && sch.open && sch.close ? `${sch.open} a ${sch.close}` : '';
    return open ? `<b class="is-open">Abierto</b>${hours ? ` · hasta las ${esc(sch.close)}` : ''}` : `<b class="is-closed">Cerrado</b>${hours ? ` · abre ${esc(hours)}` : ''}`;
  }

  function headerHtml() {
    const rating = comercio.ratingAverage > 0 && comercio.ratingCount > 0
      ? `<span class="mk-rating">${icon('star', 13, '', '#f59e0b')} ${comercio.ratingAverage.toFixed(1)} <small>(${comercio.ratingCount})</small></span>` : '';
    return `
      <div class="mk-hero">
        ${comercio.banner ? `<img id="comercio-banner-img" src="${esc(comercio.banner)}" alt="" decoding="async" />` : ''}
        ${isDirect ? '' : `<button class="mk-back" id="mk-back" aria-label="Volver">${icon('back', 20)}</button>`}
      </div>
      <div class="mk-head comercio-info">
        <div class="mk-head-card">
          ${comercio.logo ? `<img class="mk-logo" src="${esc(comercio.logo)}" alt="" />` : `<div class="mk-logo">${icon('store', 26)}</div>`}
          <div class="mk-head-text">
            <h1>${esc(comercio.name)}</h1>
            <div class="mk-meta"><span id="comercio-status-badge">${statusText()}</span>${rating}${comercio.address ? `<span>${icon('mapPin', 13)} ${esc(comercio.address)}</span>` : ''}</div>
          </div>
        </div>
        <div id="comercio-pause-banner" class="mk-paused" style="display:${comercio.isPaused ? 'flex' : 'none'}">${icon('pause', 16)} El comercio pausó los pedidos por un rato.</div>
      </div>`;
  }

  function barHtml() {
    const active = view.type === 'cat' ? view.id : (view.type === 'home' ? 'home' : '');
    const chips = [`<button class="mk-chip${active === 'home' ? ' is-on' : ''}" data-go="home">Inicio</button>`]
      .concat(offers.length ? [`<button class="mk-chip${view.type === 'offers' ? ' is-on' : ''}" data-go="offers">${icon('percent', 13)} Ofertas</button>`] : [])
      .concat(visibleTops().map((t) => `<button class="mk-chip${active === t.id ? ' is-on' : ''}" data-go="cat:${esc(t.id)}">${esc(t.name)}</button>`));
    return `
      <div class="mk-bar${searchOpen || searchText ? ' is-searching' : ''}" id="mk-bar">
        <div class="mk-bar-top">
          <div class="mk-brand">
            ${comercio.logo ? `<img src="${esc(comercio.logo)}" alt="" />` : `<span>${icon('store', 16)}</span>`}
            <b>${esc(comercio.name)}</b>
          </div>
          <button class="mk-lupa" id="mk-lupa" aria-label="Buscar productos">${icon('search', 19)}<span>Buscar en ${esc(comercio.name)}</span></button>
          <label class="mk-search">${icon('search', 17)}<input id="mk-search" type="search" placeholder="Buscar en ${esc(comercio.name)}" autocomplete="off" value="${esc(searchText)}" />
            <button id="mk-search-clear" aria-label="Borrar" style="display:${searchText ? 'flex' : 'none'}">${icon('close', 15)}</button></label>
          <button class="mk-cancel" id="mk-search-cancel">Cancelar</button>
        </div>
        <div class="mk-row-wrap is-chips">
          <button class="mk-arrow is-left" data-scroll="-1" aria-label="Anteriores">${icon('chevronLeft', 16)}</button>
          <div class="mk-chips mk-row" id="mk-chips">${chips.join('')}</div>
          <button class="mk-arrow is-right" data-scroll="1" aria-label="Siguientes">${icon('chevronRight', 16)}</button>
        </div>
        <div class="mk-suggest" id="mk-suggest" hidden></div>
      </div>`;
  }

  // ─── vistas
  function topSellers(n = 16) {
    return products.filter((p) => isAvailable(p) && (p.popularity || 0) > 0 && !HIDE_IN_TOP.includes(topName(p))).sort(byPopularity).slice(0, n);
  }

  // ─── combos y promos (panel → Promos → Armar un combo): arriba de todo, en tarjetas grandes
  const combos = () => products.filter((p) => p.isCombo && isAvailable(p)).sort(byPopularity);
  function comboCardHtml(p) {
    // Combos: la foto propia en alta si la tiene; si no, las fotos grandes de lo que incluye
    const itemImgs = (p.comboItems || []).map((x) => { const q = byId.get(x.productId); return (q && q.imageHd) || x.image; }).filter(Boolean).slice(0, 3);
    const itemsHd = (p.comboItems || []).length > 0 && (p.comboItems || []).every((x) => byId.get(x.productId)?.imageHd);
    const own = p.imageHd || (!itemsHd && p.image) || '';
    const imgs = own ? [own] : itemImgs;
    // Por separado, con los precios de hoy (los de la caja cambian): el guardado solo si falta algún producto
    const live = (p.comboItems || []).map((x) => { const q = byId.get(x.productId); return q ? (Number(q.price) || 0) * (Number(x.qty) || 1) : null; });
    const reg = live.length && live.every((v) => v !== null) ? live.reduce((t, v) => t + v, 0) : (Number(p.comboRegularPrice) || 0);
    const items = (p.comboItems || []).map((x) => `${x.qty > 1 ? `${x.qty} ` : ''}${displayName(x.name)}`).join(' + ');
    return `<article class="mk-promo mk-card" data-pid="${esc(p.id)}">
      <div class="mk-promo-img is-${own ? 'photo' : imgs.length}">${imgs.map((src) => `<img src="${esc(src)}" alt="" loading="lazy" />`).join('') || icon('gift', 30)}</div>
      <div class="mk-promo-body">
        ${reg > p.price ? `<span class="mk-promo-save">Ahorrás ${formatPrice(reg - p.price)}</span>` : '<span class="mk-promo-save is-plain">Promo</span>'}
        <h3>${esc(displayName(p.name))}</h3>
        ${items ? `<p>${esc(items)}</p>` : ''}
        <div class="mk-promo-foot"><div class="mk-promo-price">${formatPrice(p.price)}${reg > p.price ? `<s>${formatPrice(reg)}</s>` : ''}</div><div class="mk-cta">${stepperHtml(p)}</div></div>
      </div>
    </article>`;
  }
  function promosHtml() {
    const list = combos();
    if (!list.length) return '';
    return `<section class="mk-rail mk-promos"><header><h2>Promos del kiosco</h2></header>
      <div class="mk-row-wrap">
        <button class="mk-arrow is-left" data-scroll="-1" aria-label="Anteriores">${icon('chevronLeft', 18)}</button>
        <div class="mk-row">${list.map(comboCardHtml).join('')}</div>
        <button class="mk-arrow is-right" data-scroll="1" aria-label="Siguientes">${icon('chevronRight', 18)}</button>
      </div></section>`;
  }

  function homeHtml() {
    const tiles = visibleTops().filter((t) => String(t.name).toLowerCase() !== 'promos').map((t) => {
      // La foto elegida para el rubro (t.image); si no, la del más vendido con foto grande
      const inTop = products.filter((p) => isAvailable(p) && topOf(p.categoryId)?.id === t.id).sort(byPopularity);
      const sample = t.image || photo(inTop.find((p) => p.imageHd) || inTop.find((p) => p.image) || {});
      return `<button class="mk-tile" data-go="cat:${esc(t.id)}">${sample ? `<img src="${esc(sample)}" alt="" loading="lazy" />` : `<span>${icon('grid', 22)}</span>`}<b>${esc(t.name)}</b></button>`;
    }).join('');
    const again = reorderIds.map((id) => byId.get(id)).filter((p) => p && isAvailable(p));
    const promos = combos().length ? [] : products.filter((p) => isAvailable(p) && (/^(promo|combo)\b/i.test(p.name || '') || /combo|promo/i.test(topOf(p.categoryId)?.name || ''))).sort(byPopularity).slice(0, 16);
    const rails = visibleTops().filter((t) => String(t.name).toLowerCase() !== 'promos').map((t) => {
      const list = products.filter((p) => isAvailable(p) && topOf(p.categoryId)?.id === t.id).sort(byPopularity).slice(0, 14);
      return railHtml(`cat:${t.id}`, esc(t.name), list, `cat:${t.id}`);
    }).join('');
    const offerList = products.filter((p) => isAvailable(p) && offerOf(p)).slice(0, 16);
    return `
      ${promosHtml()}
      <div class="mk-tiles">${tiles}</div>
      ${railHtml('again', 'Volver a pedir', again, '')}
      ${railHtml('offers', 'Ofertas', offerList, 'offers')}
      ${railHtml('best', 'Lo más vendido', topSellers(), 'best')}
      ${railHtml('promos', 'Combos y promos', promos, '')}
      ${rails}`;
  }

  function gridHtml(list, key) {
    const shown = list.slice(0, (gridLimits[key] || PAGE));
    return `<div class="mk-grid">${shown.map((p) => cardHtml(p)).join('')}</div>
      ${list.length > shown.length ? `<button class="mk-more-btn" data-more="${esc(key)}">Ver más (${list.length - shown.length})</button>` : ''}`;
  }
  const gridLimits = {};

  function categoryHtml() {
    const top = catById(view.id);
    if (!top) return '';
    const subs = subsOf(top.id);
    const inTop = (p) => topOf(p.categoryId)?.id === top.id && isAvailable(p);
    const subChips = subs.length ? `<div class="mk-row-wrap is-chips is-sub">
      <button class="mk-arrow is-left" data-scroll="-1" aria-label="Anteriores">${icon('chevronLeft', 16)}</button>
      <div class="mk-subchips mk-row">${[`<button class="mk-chip is-small${!view.sub ? ' is-on' : ''}" data-sub="">Todo</button>`]
      .concat(subs.filter((s) => products.some((p) => p.categoryId === s.id && isAvailable(p))).map((s) => `<button class="mk-chip is-small${view.sub === s.id ? ' is-on' : ''}" data-sub="${esc(s.id)}">${esc(s.name)}</button>`)).join('')}</div>
      <button class="mk-arrow is-right" data-scroll="1" aria-label="Siguientes">${icon('chevronRight', 16)}</button>
    </div>` : '';
    const loading = !loadedCats.has(top.id) ? '<div class="mk-loading"><span></span>Cargando productos…</div>' : '';
    let body;
    if (view.sub) {
      body = gridHtml(products.filter((p) => p.categoryId === view.sub && isAvailable(p)).sort(byPopularity), `sub:${view.sub}`);
    } else if (subs.length) {
      const own = products.filter((p) => p.categoryId === top.id && isAvailable(p)).sort(byPopularity);
      body = subs.map((s) => {
        const list = products.filter((p) => p.categoryId === s.id && isAvailable(p)).sort(byPopularity);
        if (!list.length) return '';
        return `<section class="mk-section"><header><h3>${esc(s.name)}</h3>${list.length > 10 ? `<button class="mk-more" data-sub="${esc(s.id)}">Ver ${list.length} ${icon('chevronRight', 14)}</button>` : ''}</header>${gridHtml(list.slice(0, 10), `peek:${s.id}`)}</section>`;
      }).join('') + (own.length ? `<section class="mk-section"><header><h3>Otros</h3></header>${gridHtml(own, `own:${top.id}`)}</section>` : '');
    } else {
      body = gridHtml(products.filter(inTop).sort(byPopularity), `cat:${top.id}`);
    }
    return `<div class="mk-title"><h2>${esc(top.name)}</h2></div>${subChips}${loading}${body || (loading ? '' : '<div class="mk-empty">Todavía no hay productos en este rubro.</div>')}`;
  }

  function searchHtml() {
    const tokens = searchTokens(searchText);
    const list = products.filter((p) => isAvailable(p) && matches(p.name, tokens, p.barcode)).sort(byPopularity);
    return `<div class="mk-title"><h2>Resultados para “${esc(searchText)}”</h2></div>
      ${searching ? '<div class="mk-loading"><span></span>Buscando en todo el kiosco…</div>' : ''}
      ${list.length ? gridHtml(list, `q:${searchText}`) : (searching ? '' : `<div class="mk-empty"><b>No encontramos “${esc(searchText)}”.</b>Probá con otra palabra o la marca.</div>`)}`;
  }

  function listHtml(title, list, key) {
    return `<div class="mk-title"><h2>${title}</h2></div>${list.length ? gridHtml(list, key) : '<div class="mk-empty">No hay productos acá por ahora.</div>'}`;
  }

  function mainHtml() {
    if (searchText) return searchHtml();
    if (view.type === 'cat') return categoryHtml();
    if (view.type === 'best') return listHtml('Lo más vendido', topSellers(200), 'best');
    if (view.type === 'offers') return listHtml('Ofertas', products.filter((p) => isAvailable(p) && offerOf(p)), 'offers');
    return homeHtml();
  }

  // ─── dibujar
  content.innerHTML = `<div class="mk-page${isDirect ? ' is-direct' : ''}">${headerHtml()}<div id="mk-bar-slot">${barHtml()}</div><main class="mk-main" id="mk-main"></main><div class="mk-pairs" id="mk-pairs" hidden></div></div>`;
  const page = content.querySelector('.mk-page');
  const main = page.querySelector('#mk-main');

  function renderBar() {
    const slot = page.querySelector('#mk-bar-slot');
    const hadFocus = document.activeElement?.id === 'mk-search';
    const pos = hadFocus ? document.activeElement.selectionStart : null;
    const chipsScroll = page.querySelector('#mk-chips')?.scrollLeft || 0;
    slot.innerHTML = barHtml();
    page.querySelector('#mk-chips').scrollLeft = chipsScroll;
    if (hadFocus) { const i = page.querySelector('#mk-search'); i.focus(); try { i.setSelectionRange(pos, pos); } catch (e) {} }
    bindBar();
    updateArrows();
  }
  function renderMain() { main.innerHTML = mainHtml(); updateArrows(); }
  const render = () => { renderBar(); renderMain(); };

  function go(target, { scroll = true } = {}) {
    searchText = '';
    if (target === 'home') view = { type: 'home' };
    else if (target === 'best' || target === 'offers') view = { type: target };
    else if (target.startsWith('cat:')) { view = { type: 'cat', id: target.slice(4), sub: '' }; loadCategory(view.id); }
    render();
    if (scroll) scrollToMain();
    const chip = page.querySelector('#mk-chips .is-on');
    if (chip) chip.parentElement.scrollTo({ left: chip.offsetLeft - 40, behavior: 'smooth' });
  }
  // La tienda se abre dentro de un panel que hace su propio scroll (#app-overlay); en la tienda directa, la ventana
  function scroller() {
    for (let el = page.parentElement; el && el !== document.body; el = el.parentElement) {
      const oy = getComputedStyle(el).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight) return el;
    }
    return null;
  }
  const scrollTopNow = () => { const s = scroller(); return s ? s.scrollTop : window.scrollY; };
  function scrollToMain() {
    const bar = page.querySelector('#mk-bar');
    const s = scroller();
    const base = s ? s.getBoundingClientRect().top : 0;
    const top = main.getBoundingClientRect().top - base + scrollTopNow() - (bar?.offsetHeight || 0) - 8;
    if (scrollTopNow() > top) (s || window).scrollTo({ top, behavior: 'smooth' });
  }

  // Flechas de las filas en PC (con el mouse no se puede deslizar de costado)
  function updateArrows() {
    page.querySelectorAll('.mk-row-wrap').forEach((w) => {
      const row = w.querySelector('.mk-row');
      if (!row) return;
      w.classList.toggle('can-left', row.scrollLeft > 4);
      w.classList.toggle('can-right', row.scrollLeft + row.clientWidth < row.scrollWidth - 4);
    });
  }
  page.addEventListener('scroll', (e) => { if (e.target.classList?.contains('mk-row')) updateArrows(); }, true);

  // ─── datos que faltan
  async function loadCategory(topId) {
    if (loadedCats.has(topId)) return;
    const ids = [topId, ...subsOf(topId).map((s) => s.id)];
    const snaps = await Promise.all(ids.map((id) => getDocsOptimized(
      query(collection(db, 'comercios', comercioId, 'products'), where('categoryId', '==', id), limit(400)),
      `comercio_products_${comercioId}_cat_${id}`, 2 * 60 * 1000).catch(() => ({ docs: [] }))));
    merge(snaps.flatMap((s) => s.docs || []));
    loadedCats.add(topId);
    if (view.type === 'cat' && view.id === topId && !searchText) renderMain();
  }
  function merge(docs) {
    let added = 0;
    for (const d of docs) {
      const p = { id: d.id, ...d.data() };
      if (byId.has(p.id)) { Object.assign(byId.get(p.id), p); continue; }
      products.push(p); byId.set(p.id, p); added++;
    }
    if (added) { best = bestThreshold(); setState('currentProducts', products); }
    return added;
  }

  let searching = false;
  let searchSeq = 0;
  const remoteDone = new Set();
  async function runSearch() {
    const seq = ++searchSeq;
    const tokens = searchTokens(searchText);
    // Catálogo grande: se piden a la base solo los que tienen la palabra más larga buscada
    const key = tokens.slice().sort((a, b) => b.length - a.length)[0];
    if (products.length >= BIG_CATALOG && key && key.length >= 2 && !remoteDone.has(key.slice(0, 10))) {
      searching = true; renderMain();
      const k = key.slice(0, 10);
      const snap = await getDocsOptimized(
        query(collection(db, 'comercios', comercioId, 'products'), where('searchKeys', 'array-contains', k), limit(120)),
        `comercio_search_${comercioId}_${k}`, 2 * 60 * 1000).catch(() => ({ docs: [] }));
      remoteDone.add(k);
      merge(snap.docs || []);
      if (seq !== searchSeq) return;
      searching = false;
    }
    renderMain();
  }

  async function loadReorder() {
    const user = getState().user;
    if (!user) return;
    try {
      const snap = await getDocsOptimized(
        query(collection(db, 'orders'), where('userId', '==', user.uid), where('comercioId', '==', comercioId), limit(10)),
        `comercio_reorder_${comercioId}_${user.uid}`, 5 * 60 * 1000);
      const count = new Map();
      (snap.docs || []).forEach((d) => (d.data().items || []).forEach((it) => { if (it.productId) count.set(it.productId, (count.get(it.productId) || 0) + 1); }));
      reorderIds = [...count].sort((a, b) => b[1] - a[1]).map(([id]) => id).slice(0, 16);
      const missing = reorderIds.filter((id) => !byId.has(id));
      for (let i = 0; i < missing.length; i += 10) {
        const s = await getDocsOptimized(query(collection(db, 'comercios', comercioId, 'products'), where(documentId(), 'in', missing.slice(i, i + 10))),
          `comercio_products_${comercioId}_ids_${missing.slice(i, i + 10).join(',')}`, 5 * 60 * 1000).catch(() => ({ docs: [] }));
        merge(s.docs || []);
      }
      if (reorderIds.length && view.type === 'home' && !searchText) renderMain();
    } catch (e) { /* sin pedidos anteriores: no se muestra la fila */ }
  }

  async function loadCombos() {
    const snap = await getDocsOptimized(
      query(collection(db, 'comercios', comercioId, 'products'), where('isCombo', '==', true), limit(30)),
      `comercio_products_${comercioId}_combos`, 5 * 60 * 1000).catch(() => ({ docs: [] }));
    const before = combos().length;
    merge(snap.docs || []);
    if (combos().length !== before && view.type === 'home' && !searchText) renderMain();
  }

  async function loadTopSellers() {
    if (products.length < BIG_CATALOG) return;
    const snap = await getDocsOptimized(
      query(collection(db, 'comercios', comercioId, 'products'), orderBy('popularity', 'desc'), limit(120)),
      `comercio_products_${comercioId}_popular`, 10 * 60 * 1000).catch(() => ({ docs: [] }));
    if (merge(snap.docs || []) && view.type === 'home' && !searchText) renderMain();
  }

  // ─── "Combiná con…"
  let pairsTimer = null;
  async function showPairs(p) {
    const ids = Array.isArray(p.pairsVentra) ? p.pairsVentra.slice(0, 6) : [];
    if (!ids.length) return;
    let list = products.filter((x) => ids.includes(x.ventraId));
    const missing = ids.filter((v) => !list.some((x) => x.ventraId === v));
    if (missing.length) {
      const s = await getDocsOptimized(query(collection(db, 'comercios', comercioId, 'products'), where('ventraId', 'in', missing)),
        `comercio_pairs_${comercioId}_${missing.join(',')}`, 10 * 60 * 1000).catch(() => ({ docs: [] }));
      merge(s.docs || []);
      list = products.filter((x) => ids.includes(x.ventraId));
    }
    list = list.filter((x) => isAvailable(x) && qtyOf(x) === 0).sort((a, b) => ids.indexOf(a.ventraId) - ids.indexOf(b.ventraId)).slice(0, 4);
    if (!list.length) return;
    const box = page.querySelector('#mk-pairs');
    box.innerHTML = `<div class="mk-pairs-head"><b>Combiná con ${esc(displayName(p.name))}</b><button data-act="close-pairs" aria-label="Cerrar">${icon('close', 16)}</button></div>
      <div class="mk-row">${list.map((x) => cardHtml(x, true)).join('')}</div>`;
    box.hidden = false;
    requestAnimationFrame(() => box.classList.add('is-on'));
    clearTimeout(pairsTimer);
    pairsTimer = setTimeout(hidePairs, 9000);
  }
  function hidePairs() {
    const box = page.querySelector('#mk-pairs');
    if (!box) return;
    box.classList.remove('is-on');
    setTimeout(() => { box.hidden = true; }, 250);
  }

  // ─── acciones
  function canBuy() {
    if (comercio.isPaused) { showToast('Este comercio pausó los pedidos por un rato. Volvé a intentar más tarde.', 'warning'); return false; }
    if (!isOpenNow()) { showToast('El comercio está cerrado. No se pueden agregar productos.', 'warning'); return false; }
    return true;
  }
  function afterCartChange() {
    renderNavbar();
    if (!isDirect) updateGlobalCartFAB();
  }
  function add(p, fromPairs) {
    if (!canBuy()) return;
    if (needsModal(p)) { openProductModal(p, comercioId, comercio.name, isOpenNow()); return; }
    if (navigator.vibrate) navigator.vibrate(12);
    addToCart(p, comercioId, comercio.name, 1);
    afterCartChange();
    if (isAdult(p)) {
      try {
        if (!sessionStorage.getItem('gd_adult_notice')) {
          sessionStorage.setItem('gd_adult_notice', '1');
          showToast('Solo para mayores de 18: el repartidor te va a pedir el DNI al entregar.', 'info');
        }
      } catch (e) { /* sin almacenamiento */ }
    }
    if (!fromPairs) showPairs(p);
  }

  page.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest('#mk-back')) { e.preventDefault(); goBack(); return; }
    const scrollBtn = t.closest('[data-scroll]');
    if (scrollBtn) {
      const row = scrollBtn.parentElement.querySelector('.mk-row');
      row.scrollBy({ left: Number(scrollBtn.dataset.scroll) * row.clientWidth * 0.85, behavior: 'smooth' });
      return;
    }
    if (t.closest('[data-act="close-pairs"]')) { hidePairs(); return; }
    if (t.closest('#mk-suggest')) return; // las sugerencias se atienden al apretar (mousedown)
    const goBtn = t.closest('[data-go]');
    if (goBtn) { hideSuggest(); go(goBtn.dataset.go); return; }
    const subBtn = t.closest('[data-sub]');
    if (subBtn) { view = { ...view, sub: subBtn.dataset.sub }; renderMain(); scrollToMain(); return; }
    const moreBtn = t.closest('[data-more]');
    if (moreBtn) { const k = moreBtn.dataset.more; gridLimits[k] = (gridLimits[k] || PAGE) + PAGE * 2; renderMain(); return; }
    const card = t.closest('.mk-card');
    if (!card) return;
    const p = byId.get(card.dataset.pid);
    if (!p) return;
    const act = t.closest('[data-act]')?.dataset.act;
    const fromPairs = !!t.closest('#mk-pairs');
    if (act === 'add' || act === 'inc') { e.stopPropagation(); add(p, fromPairs || act === 'inc'); return; }
    if (act === 'dec') {
      e.stopPropagation();
      const line = cartLine(p) || (getState().cart || []).find((i) => i.comercioId === comercioId && i.product?.id === p.id);
      if (line) { updateCartQty(line.cartItemId, comercioId, line.qty - 1); afterCartChange(); }
      return;
    }
    if (!isAvailable(p)) return;
    openProductModal(p, comercioId, comercio.name, isOpenNow());
  });

  function goBack() {
    if (window.history.length > 1) {
      const before = window.location.hash;
      window.history.back();
      setTimeout(() => { if (window.location.hash === before) window.location.hash = '#/'; }, 400);
    } else window.location.hash = '#/';
  }

  // ─── buscador
  let debounce = null;
  function popularSearches() {
    // Los subrubros que más se venden: tocar uno lleva a sus productos
    const score = new Map();
    products.filter((p) => isAvailable(p) && !HIDE_IN_TOP.includes(topName(p))).forEach((p) => {
      const c = catById(p.categoryId);
      if (c) score.set(c.id, (score.get(c.id) || 0) + (p.popularity || 0));
    });
    return [...score].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id]) => catById(id)).filter(Boolean);
  }
  function showSuggest() {
    const box = page.querySelector('#mk-suggest');
    if (!box || searchText) return;
    const pop = popularSearches();
    if (!pop.length) return;
    box.innerHTML = `<b>Lo que más se busca</b><div>${pop.map((c) => `<button class="mk-chip is-small" data-go="cat:${esc(c.parentCategoryId || c.id)}" data-sub-after="${c.parentCategoryId ? esc(c.id) : ''}">${esc(c.name)}</button>`).join('')}</div>`;
    box.hidden = false;
  }
  function hideSuggest() { const box = page.querySelector('#mk-suggest'); if (box) box.hidden = true; }

  function bindBar() {
    page.querySelector('#mk-lupa').addEventListener('click', () => {
      searchOpen = true;
      page.querySelector('#mk-bar').classList.add('is-searching');
      const i = page.querySelector('#mk-search');
      i.focus();
      showSuggest();
    });
    page.querySelector('#mk-search-cancel').addEventListener('click', (e) => {
      e.preventDefault();
      const had = !!searchText;
      searchOpen = false; searchText = '';
      hideSuggest();
      if (had) render(); else page.querySelector('#mk-bar').classList.remove('is-searching');
    });
    const input = page.querySelector('#mk-search');
    const clear = page.querySelector('#mk-search-clear');
    input.addEventListener('focus', showSuggest);
    input.addEventListener('blur', () => setTimeout(hideSuggest, 200));
    input.addEventListener('input', () => {
      searchText = input.value.trim();
      clear.style.display = searchText ? 'flex' : 'none';
      if (searchText) hideSuggest(); else showSuggest();
      clearTimeout(debounce);
      debounce = setTimeout(() => { if (searchText) { scrollToMain(); runSearch(); } else renderMain(); }, 220);
    });
    clear.addEventListener('click', (e) => { e.preventDefault(); input.value = ''; searchText = ''; clear.style.display = 'none'; renderMain(); input.focus(); });
  }
  // Las sugerencias llevan al subrubro, no solo al rubro
  page.addEventListener('mousedown', (e) => {
    const b = e.target.closest('#mk-suggest [data-sub-after]');
    if (!b) return;
    e.preventDefault();
    hideSuggest();
    go(b.dataset.go);
    if (b.dataset.subAfter) { view = { ...view, sub: b.dataset.subAfter }; renderMain(); }
  });

  // Barra fija: al bajar se achica (solo el nombre, el buscador y los rubros)
  const onScroll = () => {
    const bar = page.querySelector('#mk-bar');
    if (!bar) return;
    const s = scroller();
    bar.classList.toggle('is-stuck', bar.getBoundingClientRect().top <= (s ? s.getBoundingClientRect().top : 0) + 1);
  };
  // capture: también el scroll del panel donde se abre la tienda
  document.addEventListener('scroll', onScroll, { passive: true, capture: true });

  // Cantidades al día en las tarjetas cuando cambia el carrito (también desde la ficha o el carrito)
  const unsubCart = subscribe('cart', () => {
    page.querySelectorAll('.mk-card').forEach((card) => {
      const p = byId.get(card.dataset.pid);
      const cta = card.querySelector('.mk-cta');
      if (p && cta) cta.innerHTML = stepperHtml(p);
    });
  });

  render();
  loadCombos();
  loadTopSellers();
  loadReorder();

  return {
    /** Datos nuevos (de la base, después de la carga rápida desde el caché) */
    update(next) {
      comercio = next.comercio || comercio;
      categories = next.categories || categories;
      offers = next.activeOffers || offers;
      merge((next.products || []).map((p) => ({ id: p.id, data: () => p })));
      best = bestThreshold();
      render();
    },
    cleanup() {
      unsubCart();
      document.removeEventListener('scroll', onScroll, { capture: true });
      clearTimeout(pairsTimer);
    },
  };
}
