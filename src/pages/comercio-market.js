// GoDelivery — Tienda tipo mercado (kioscos, almacenes y comercios de Ventra con miles de productos).
// Los restaurantes usan la misma, con los platos en lista (también en el catálogo online). Acá: portada con rubros, "Lo más vendido",
// "Volver a pedir", una fila por rubro; tarjetas con foto arriba y "– 2 +"; buscador que busca en todo
// el catálogo (searchKeys, sin bajar miles de productos) y "Combiná con…" al agregar.
import { db } from '../firebase.js';
import { collection, query, where, limit, orderBy, documentId } from 'firebase/firestore';
import { addToCart, updateCartQty, getState, setState, subscribe, isProductFavorite, toggleProductFavorite } from '../state.js';
import { getDocsOptimized } from '../utils/firestore-cache.js';
import { formatPrice, isShopOpen } from '../utils/format.js';
import { closesAtText, opensAtText } from '../utils/commerce-hours.js';
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
// Con más rubros que esto, Inicio y la barra muestran solo los que más venden; el resto, en la hoja "Categorías"
const FEW_TOPS = 8;
const FEATURED = { chips: 6, tiles: 7, rails: 5 };
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Tiendas que se muestran como mercado: las que arma el repartidor, las de Ventra y los rubros de kiosco */
export function isMarketStore(comercio) {
  if (!comercio) return false;
  if (comercio.fulfillmentMode === 'shopper' || comercio.ventraLinked === true) return true;
  const cats = [comercio.category, ...(Array.isArray(comercio.categories) ? comercio.categories : [])].map((c) => String(c || '').toLowerCase());
  return cats.some((c) => MARKET_CATEGORIES.includes(c));
}

const inStock = (p) => p.isAvailable !== false && !(p.stockMode === 'limited' && (p.stockQuantity || 0) <= 0);
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
  // Restaurantes y demás comercios que no son mercado: la misma tienda (tarjeta, barra, buscador, "atrás"), pero los
  // platos en lista con su descripción y todas las categorías una debajo de otra
  const menu = !isMarketStore(comercio);
  let loaded = products.length > 0;
  // Sin stock de ningún sabor (heladerías): no se ofrece
  function flavorsOut(p) {
    if (!p.useGlobalFlavors) return false;
    const all = comercio.sabores || [];
    const list = p.allowedFlavors && p.allowedFlavors.length ? all.filter((f) => p.allowedFlavors.includes(f.name)) : all;
    if (list.some((f) => !f.isAvailable || f.stock === undefined || f.stock === null || f.stock === '')) return false;
    return list.reduce((t, f) => t + (f.stock || 0), 0) <= 0;
  }
  const isAvailable = (p) => inStock(p) && !flavorsOut(p);
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
  const isPromoTop = (t) => String(t.name).toLowerCase() === 'promos';
  const manyTops = () => visibleTops().length > FEW_TOPS;
  // Por ventas: la suma de lo vendido de lo cargado (loadTopSellers ya trae los 120 de arriba); empate, el orden del comercio
  function rankedTops() {
    const score = new Map();
    products.forEach((p) => { const t = isAvailable(p) && topOf(p.categoryId); if (t) score.set(t.id, (score.get(t.id) || 0) + (p.popularity || 0)); });
    return visibleTops().map((t, i) => ({ t, i, s: score.get(t.id) || 0 })).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.t);
  }
  // Los que se destacan: con pocos rubros, todos en su orden; con muchos, los que más venden (sin cigarrillos)
  function featuredTops(n) {
    if (!manyTops()) return visibleTops().filter((t) => !isPromoTop(t));
    return rankedTops().filter((t) => !isPromoTop(t) && !HIDE_IN_TOP.includes(String(t.name).toLowerCase())).slice(0, n);
  }
  // La foto elegida para el rubro (t.image); si no, la del más vendido con foto grande
  function topImage(t) {
    const inTop = products.filter((p) => isAvailable(p) && topOf(p.categoryId)?.id === t.id).sort(byPopularity);
    return t.image || photo(inTop.find((p) => p.imageHd) || inTop.find((p) => p.image) || {});
  }

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

  // Cerrado o en pausa: sin "+" (tocarlo solo daba un aviso que pasaba desapercibido); el aviso va debajo de la tarjeta
  const canOrder = () => !comercio.isPaused && isOpenNow();
  function stepperHtml(p) {
    if (!isAvailable(p)) return '<span class="mk-out">Agotado</span>';
    if (!canOrder() && !qtyOf(p)) return '';
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
      ${!mini && Number(p.transferSurcharge) > 0 ? `<div class="mk-surcharge">Con transferencia ${formatPrice(Math.round(price * (1 + Number(p.transferSurcharge) / 100)))}</div>` : ''}
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
    // Del horario por día y siguiendo los minutos abiertos: antes leía solo el primer turno viejo y
    // un kiosco abierto de corrido el fin de semana decía "hasta las 23:59"
    if (isOpenNow()) {
      const until = closesAtText(comercio);
      return `<b class="is-open">Abierto</b> · ${until ? `hasta ${esc(until)}` : 'las 24 horas'}`;
    }
    const opens = opensAtText(comercio);
    return `<b class="is-closed">Cerrado</b>${opens ? ` · abre ${esc(opens)}` : ''}`;
  }

  // La tarjeta del comercio, igual en todas las tiendas: rubro · calle, nombre con su puntaje, descripción y
  // una fila con el estado y el envío. El corazón guarda el comercio en favoritos.
  const isFavStore = () => isProductFavorite(comercioId);
  function feeText() {
    const fee = (getState().dynamicDeliveryFees || {})[comercioId];
    if (typeof fee !== 'number' || !(fee >= 0)) return '';
    return `${icon('bike', 14)} ${fee === 0 ? 'Envío gratis' : `Envío ${formatPrice(fee)}`}`;
  }
  function ratingHtml() {
    const has = comercio.ratingAverage > 0 && comercio.ratingCount > 0;
    return `<button class="mk-rate" id="mk-rate" aria-label="${has ? 'Ver o dejar tu puntaje' : 'Puntuar este comercio'}">${icon('star', 13, '', '#f59e0b')}${has ? `${comercio.ratingAverage.toFixed(1)} <small>(${comercio.ratingCount})</small>` : '<small>Puntuar</small>'}</button>`;
  }
  // Catálogo online (el link que comparte el comercio): escribirle por WhatsApp y cómo llegar
  function directLinksHtml() {
    const phone = String(comercio.whatsapp || comercio.phone || '').replace(/\D/g, '');
    const wa = phone ? (phone.startsWith('54') ? phone : `549${phone}`) : '';
    const maps = comercio.coords?.lat
      ? `https://www.google.com/maps/search/?api=1&query=${comercio.coords.lat},${comercio.coords.lng}`
      : (comercio.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(comercio.address)}` : '');
    if (!wa && !maps) return '';
    return `<div class="mk-links">
      ${wa ? `<a class="mk-link is-wa" href="https://wa.me/${wa}?text=${encodeURIComponent(`¡Hola ${comercio.name}! Te escribo desde tu catálogo online.`)}" target="_blank" rel="noopener noreferrer">${icon('whatsapp', 16)}WhatsApp</a>` : ''}
      ${maps ? `<a class="mk-link" href="${esc(maps)}" target="_blank" rel="noopener noreferrer">${icon('mapPin', 16)}Cómo llegar</a>` : ''}
    </div>`;
  }
  const footHtml = () => `<footer class="mk-foot">
      <a href="https://godelivery-magdalena.web.app/descargar.html" target="_blank" rel="noopener noreferrer"><span class="mk-go">GO!</span>Pedidos online con GO! Delivery</a>
      <span>Magdalena · pedí a domicilio o retirá en el local</span>
    </footer>`;

  function headerHtml() {
    const street = comercio.address ? String(comercio.address).split(',')[0] : '';
    const kicker = [comercio.category, street].filter(Boolean).map((x) => esc(x)).join(' · ');
    const fee = feeText();
    return `
      <div class="mk-hero">
        ${comercio.banner ? `<img id="comercio-banner-img" src="${esc(comercio.banner)}" alt="" decoding="async" />` : ''}
        ${isDirect ? `<button class="mk-back" id="mk-share" aria-label="Compartir">${icon('share', 18)}</button>` : `<button class="mk-back" id="mk-back" aria-label="Volver">${icon('back', 20)}</button>`}
        <button class="mk-fav${isFavStore() ? ' is-on' : ''}" id="mk-fav" aria-label="Guardar en favoritos" aria-pressed="${isFavStore()}">${icon('heart', 19)}</button>
      </div>
      <div class="mk-head comercio-info">
        <div class="mk-head-card">
          <div class="mk-head-main">
            ${comercio.logo ? `<img class="mk-logo" src="${esc(comercio.logo)}" alt="" />` : `<div class="mk-logo">${icon('store', 26)}</div>`}
            <div class="mk-head-text">
              ${kicker ? `<span class="mk-kicker">${kicker}</span>` : ''}
              <div class="mk-title-row"><h1>${esc(comercio.name)}</h1>${ratingHtml()}</div>
              ${comercio.description ? `<p class="mk-desc comercio-description">${esc(comercio.description)}</p>` : ''}
            </div>
          </div>
          <div class="mk-facts">
            <span class="mk-fact" id="comercio-status-badge">${statusText()}</span>
            <span class="mk-fact" id="mk-fee"${fee ? '' : ' hidden'}>${fee}</span>
          </div>
          ${isDirect ? directLinksHtml() : ''}
        </div>
        <div id="comercio-pause-banner" class="mk-paused" style="display:${comercio.isPaused ? 'flex' : 'none'}">${icon('pause', 16)} El comercio pausó los pedidos por un rato.</div>
        ${!comercio.isPaused && !isOpenNow() ? `<div class="mk-closed-note">${icon('clock', 16)}<span><b>Ahora está cerrado.</b> Podés mirar ${menu ? 'el menú' : 'los productos'} y pedir cuando abra${opensAtText(comercio) ? ` (${esc(opensAtText(comercio))})` : ''}.</span></div>` : ''}
      </div>`;
  }

  function barHtml() {
    const active = view.type === 'cat' ? view.id : (view.type === 'home' ? 'home' : '');
    // Con muchos rubros: "Categorías" primero (abre la hoja con todos) y después solo los que más venden, más el que se está viendo
    let shown = visibleTops();
    if (manyTops()) {
      shown = featuredTops(FEATURED.chips);
      const cur = active && catById(active);
      if (cur && !shown.includes(cur)) shown = [cur, ...shown];
    }
    const offersChip = offers.length ? [`<button class="mk-chip${view.type === 'offers' ? ' is-on' : ''}" data-go="offers">${icon('percent', 13)} Ofertas</button>`] : [];
    const favsChip = products.some((p) => isProductFavorite(p.id)) ? [`<button class="mk-chip${view.type === 'favs' ? ' is-on' : ''}" data-go="favs">${icon('heart', 13)} Favoritos</button>`] : [];
    // Menú: todas las categorías en una página; el chip baja a la suya y se marca solo al deslizar
    const chips = menu
      ? offersChip.concat(favsChip, (manyTops() ? featuredTops(FEATURED.chips) : visibleTops()).filter((t) => groupOf(t).length).map((t) => `<button class="mk-chip" data-jump="${esc(t.id)}">${esc(t.name)}</button>`))
      : [`<button class="mk-chip${active === 'home' ? ' is-on' : ''}" data-go="home">Inicio</button>`]
        .concat(offersChip, favsChip, shown.map((t) => `<button class="mk-chip${active === t.id ? ' is-on' : ''}" data-go="cat:${esc(t.id)}">${esc(t.name)}</button>`));
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
        <div class="mk-chipbar${manyTops() ? ' has-rubros' : ''}">
          ${manyTops() ? `<button class="mk-chip is-rubros" data-rubros aria-label="Ver todas las categorías">${icon('grid', 14)}<span>Categorías</span></button>` : ''}
          <div class="mk-row-wrap is-chips">
            <button class="mk-arrow is-left" data-scroll="-1" aria-label="Anteriores">${icon('chevronLeft', 16)}</button>
            <div class="mk-chips mk-row" id="mk-chips">${chips.join('')}</div>
            <button class="mk-arrow is-right" data-scroll="1" aria-label="Siguientes">${icon('chevronRight', 16)}</button>
          </div>
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
    return `<section class="mk-rail mk-promos"><header><h2>${menu ? 'Promos' : 'Promos del kiosco'}</h2></header>
      <div class="mk-row-wrap">
        <button class="mk-arrow is-left" data-scroll="-1" aria-label="Anteriores">${icon('chevronLeft', 18)}</button>
        <div class="mk-row">${list.map(comboCardHtml).join('')}</div>
        <button class="mk-arrow is-right" data-scroll="1" aria-label="Siguientes">${icon('chevronRight', 18)}</button>
      </div></section>`;
  }

  function homeHtml() {
    const tiles = featuredTops(FEATURED.tiles).map((t) => {
      const sample = topImage(t);
      return `<button class="mk-tile" data-go="cat:${esc(t.id)}">${sample ? `<img src="${esc(sample)}" alt="" loading="lazy" />` : `<span>${icon('grid', 22)}</span>`}<b>${esc(t.name)}</b></button>`;
    }).join('') + (manyTops() ? `<button class="mk-tile is-all" data-rubros><span>${icon('grid', 22)}<small>${visibleTops().length}</small></span><b>Ver todas</b></button>` : '');
    const again = reorderIds.map((id) => byId.get(id)).filter((p) => p && isAvailable(p));
    const promos = combos().length ? [] : products.filter((p) => isAvailable(p) && (/^(promo|combo)\b/i.test(p.name || '') || /combo|promo/i.test(topOf(p.categoryId)?.name || ''))).sort(byPopularity).slice(0, 16);
    const rails = featuredTops(FEATURED.rails).map((t) => {
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
      ${rails}
      ${manyTops() ? `<button class="mk-more-btn is-rubros" data-rubros>${icon('grid', 16)} Ver las ${visibleTops().length} categorías</button>` : ''}`;
  }

  // Fila del menú: nombre, descripción y precio a la izquierda; la foto con el "+" a la derecha
  function rowHtml(p) {
    const o = offerOf(p);
    const price = priceOf(p);
    const img = photo(p);
    return `<article class="mk-card mk-item${img ? '' : ' is-noimg'}${isAvailable(p) ? '' : ' is-out'}" data-pid="${esc(p.id)}">
      <div class="mk-item-text">
        <h3>${esc(p.name)}</h3>
        ${p.description ? `<p>${esc(p.description)}</p>` : ''}
        <div class="mk-item-price">${formatPrice(price)}${isSoldByWeight(p) ? '<small> /kg</small>' : ''}${o ? `<s>${formatPrice(p.price)}</s><span class="mk-tag is-offer">${o.type === 'percentage' ? `${o.value}% OFF` : esc(o.label || 'Oferta')}</span>` : ''}</div>
      </div>
      <div class="mk-item-img">${img ? `<img src="${esc(img)}" alt="" loading="lazy" decoding="async" />` : ''}<div class="mk-cta">${stepperHtml(p)}</div></div>
    </article>`;
  }
  const byMenuOrder = (a, b) => (a.order ?? 9999) - (b.order ?? 9999) || String(a.name).localeCompare(String(b.name));
  // Lo de una categoría y sus subcategorías
  const groupOf = (t) => products.filter((p) => isAvailable(p) && topOf(p.categoryId)?.id === t.id);
  function menuHtml() {
    if (!loaded) return `<div class="mk-list is-skeleton">${'<div class="mk-item-skel"><span></span><span></span><span></span><i></i></div>'.repeat(5)}</div>`;
    const again = reorderIds.map((id) => byId.get(id)).filter((p) => p && isAvailable(p));
    const top = topSellers(10);
    const sections = visibleTops().map((t) => {
      const items = groupOf(t);
      if (!items.length) return '';
      const own = items.filter((p) => p.categoryId === t.id).sort(byMenuOrder);
      const subs = subsOf(t.id).map((sc) => ({ sc, list: items.filter((p) => p.categoryId === sc.id).sort(byMenuOrder) })).filter((x) => x.list.length);
      return `<section class="mk-section mk-menu-sec" data-sec="${esc(t.id)}"><header><h2>${esc(t.name)}</h2></header>
        ${own.length ? `<div class="mk-list">${own.map(rowHtml).join('')}</div>` : ''}
        ${subs.map((x) => `<h3 class="mk-subhead">${esc(x.sc.name)}</h3><div class="mk-list">${x.list.map(rowHtml).join('')}</div>`).join('')}
      </section>`;
    }).join('');
    const known = new Set(visibleTops().map((t) => t.id));
    const rest = products.filter((p) => isAvailable(p) && !known.has(topOf(p.categoryId)?.id)).sort(byMenuOrder);
    return `
      ${promosHtml()}
      ${railHtml('again', 'Volver a pedir', again, '')}
      ${top.length >= 3 ? railHtml('best', 'Lo más pedido', top, '') : ''}
      ${sections}
      ${rest.length ? `<section class="mk-section mk-menu-sec"><header><h2>${sections ? 'Otros' : 'Menú'}</h2></header><div class="mk-list">${rest.map(rowHtml).join('')}</div></section>` : ''}
      ${!sections && !rest.length ? '<div class="mk-empty">Este comercio todavía no cargó productos.</div>' : ''}`;
  }

  function gridHtml(list, key) {
    const shown = list.slice(0, (gridLimits[key] || PAGE));
    if (menu) return `<div class="mk-list">${shown.map(rowHtml).join('')}</div>
      ${list.length > shown.length ? `<button class="mk-more-btn" data-more="${esc(key)}">Ver más (${list.length - shown.length})</button>` : ''}`;
    return `<div class="mk-grid">${shown.map((p) => cardHtml(p)).join('')}</div>
      ${list.length > shown.length ? `<button class="mk-more-btn" data-more="${esc(key)}">Ver más (${list.length - shown.length})</button>` : ''}`;
  }
  const gridLimits = {};

  function categoryHtml() {
    const top = catById(view.id);
    if (!top) return '';
    const subs = subsOf(top.id);
    const inTop = (p) => topOf(p.categoryId)?.id === top.id && isAvailable(p);
    // Con todas las secciones a la vista, los chips bajan a cada una (y se marcan solos al deslizar); con una sola, filtran
    const attr = view.sub ? 'data-sub' : 'data-jump';
    const subChips = subs.length ? `<div class="mk-row-wrap is-chips is-sub">
      <button class="mk-arrow is-left" data-scroll="-1" aria-label="Anteriores">${icon('chevronLeft', 16)}</button>
      <div class="mk-subchips mk-row">${[`<button class="mk-chip is-small${!view.sub ? ' is-on' : ''}" ${attr}="">Todo</button>`]
      .concat(subs.filter((s) => products.some((p) => p.categoryId === s.id && isAvailable(p))).map((s) => `<button class="mk-chip is-small${view.sub === s.id ? ' is-on' : ''}" ${attr}="${esc(s.id)}">${esc(s.name)}</button>`)).join('')}</div>
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
        return `<section class="mk-section" data-sec="${esc(s.id)}"><header><h3>${esc(s.name)}</h3>${list.length > 10 ? `<button class="mk-more" data-sub="${esc(s.id)}">Ver ${list.length} ${icon('chevronRight', 14)}</button>` : ''}</header>${gridHtml(list.slice(0, 10), `peek:${s.id}`)}</section>`;
      }).join('') + (own.length ? `<section class="mk-section"><header><h3>Otros</h3></header>${gridHtml(own, `own:${top.id}`)}</section>` : '');
    } else {
      body = gridHtml(products.filter(inTop).sort(byPopularity), `cat:${top.id}`);
    }
    return `<div class="mk-title"><h2>${esc(top.name)}</h2></div>${subChips}${loading}${body || (loading ? '' : '<div class="mk-empty">Todavía no hay productos en esta categoría.</div>')}`;
  }

  function searchHtml() {
    const tokens = searchTokens(searchText);
    // En el menú también cuenta lo que dice el plato ("milanesa con papas")
    const list = products.filter((p) => isAvailable(p) && matches(menu ? `${p.name} ${p.description || ''}` : p.name, tokens, p.barcode)).sort(byPopularity);
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
    if (view.type === 'favs') return listHtml('Tus favoritos', products.filter((p) => isAvailable(p) && isProductFavorite(p.id)), 'favs');
    return menu ? menuHtml() : homeHtml();
  }

  // ─── dibujar
  content.innerHTML = `<div class="mk-page${isDirect ? ' is-direct' : ''}">${headerHtml()}<div id="mk-bar-slot">${barHtml()}</div><main class="mk-main" id="mk-main"></main>${isDirect ? footHtml() : ''}<div class="mk-pairs-dock"><div class="mk-pairs" id="mk-pairs" hidden></div></div></div>`;
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
  const render = () => { renderBar(); renderMain(); if (menu) requestAnimationFrame(spySub); };

  // ─── historial: la tienda ocupa un solo paso. Elegir una categoría, "Ver todo" o buscar reemplaza ese paso (no
  // agrega otro), así el "atrás" sale de la tienda a la página anterior en vez de recorrer las categorías.
  // El paso guarda la vista y dónde estaba la pantalla (y) para volver a la tienda tal como quedó.
  const sameAs = (v, q) => JSON.stringify(v) === JSON.stringify(view) && (q || '') === searchText;
  const saveScroll = () => { try { history.replaceState({ ...(history.state || {}), y: scrollTopNow() }, ''); } catch (e) { /* sin historial */ } };
  function navTo(change) {
    change();
    try { history.replaceState({ ...(history.state || {}), mkNav: comercioId, v: view, q: searchText, y: null }, ''); } catch (e) { /* sin historial */ }
  }
  function restoreScroll(y) {
    requestAnimationFrame(() => { if (y == null) scrollToMain(); else (scroller() || window).scrollTo({ top: y }); });
  }
  function onNavPop(e) {
    const s = e.state || {};
    // La hoja de categorías y los modales atienden su propio paso; un paso que no es de esta tienda es que se está
    // saliendo (no se redibuja Inicio antes de irse)
    if (s.mkRubros || s.isModalId || s.mkNav !== comercioId) return;
    const v = s.v || { type: 'home' };
    const q = s.q || '';
    if (sameAs(v, q)) return;
    view = v; searchText = q; searchOpen = !!q;
    hideSuggest();
    if (view.type === 'cat') loadCategory(view.id);
    render();
    if (searchText) runSearch();
    restoreScroll(s.y);
  }
  window.addEventListener('popstate', onNavPop);

  function go(target, { scroll = true, sub = '' } = {}) {
    // Menú: una categoría no es otra pantalla, es bajar hasta su sección (desde la hoja de categorías, por ejemplo)
    if (menu && target.startsWith('cat:')) { jumpTo(target.slice(4)); return; }
    navTo(() => {
      searchText = '';
      if (target === 'home') view = { type: 'home' };
      else if (target === 'best' || target === 'offers' || target === 'favs') view = { type: target };
      else if (target.startsWith('cat:')) view = { type: 'cat', id: target.slice(4), sub };
    });
    if (view.type === 'cat') loadCategory(view.id);
    render();
    if (scroll) scrollToMain(view.type !== 'home');
    const chip = page.querySelector('#mk-chips .is-on');
    if (chip) chip.parentElement.scrollTo({ left: chip.offsetLeft - 40, behavior: 'smooth' });
  }
  function openSub(sub) {
    navTo(() => { view = { ...view, sub }; });
    renderMain();
    scrollToMain(true);
  }

  // ─── subcategorías: bajar a su sección y marcar la que se está viendo
  // (en el menú de un restaurante, lo mismo con las categorías de la barra)
  const stickyHeight = () => (page.querySelector('#mk-bar')?.offsetHeight || 0) + (main.querySelector('.is-sub')?.offsetHeight || 0);
  const jumpRow = () => (menu ? page.querySelector('#mk-chips') : main.querySelector('.mk-subchips'));
  function markSub(id) {
    const row = jumpRow();
    if (!row) return;
    const on = row.querySelector(`[data-jump="${CSS.escape(id)}"]`);
    if (on && on.classList.contains('is-on')) return;
    row.querySelectorAll('[data-jump].is-on').forEach((b) => b.classList.remove('is-on'));
    if (!on) return;
    on.classList.add('is-on');
    row.scrollTo({ left: on.offsetLeft - 40, behavior: 'smooth' });
  }
  let jumping = null;
  function jumpTo(id) {
    // Desde Ofertas, Favoritos o una búsqueda: primero el menú entero, después la sección
    if (menu && (view.type !== 'home' || searchText)) {
      navTo(() => { view = { type: 'home' }; searchText = ''; searchOpen = false; });
      render();
    }
    const s = scroller();
    const base = s ? s.getBoundingClientRect().top : 0;
    const el = id && main.querySelector(`[data-sec="${CSS.escape(id)}"]`);
    const bar = page.querySelector('#mk-bar');
    let top = el
      ? el.getBoundingClientRect().top - base + scrollTopNow() - stickyHeight() - 4
      : main.getBoundingClientRect().top - base + scrollTopNow() - (bar?.offsetHeight || 0);
    // Siempre hasta que la barra se pegue arriba (logo y lupa), también para la primera sección
    if (bar && !bar.classList.contains('is-stuck')) top = Math.max(top, bar.getBoundingClientRect().top - base + scrollTopNow());
    markSub(id);
    // Mientras baja no se remarca cada sección que pasa
    clearTimeout(jumping);
    jumping = setTimeout(() => { jumping = null; }, 700);
    (s || window).scrollTo({ top, behavior: 'smooth' });
  }
  function spySub() {
    if (jumping || searchText || (menu ? view.type !== 'home' : (view.type !== 'cat' || view.sub))) return;
    const secs = main.querySelectorAll('[data-sec]');
    if (!secs.length) return;
    const s = scroller();
    const line = (s ? s.getBoundingClientRect().top : 0) + stickyHeight() + 16;
    let cur = '';
    secs.forEach((el) => { if (el.getBoundingClientRect().top <= line) cur = el.dataset.sec; });
    markSub(cur);
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
  // Deja el principio de la lista justo debajo de la barra. Sin force solo sube (al buscar o volver a Inicio); con
  // force (al elegir una categoría) también baja, así los botones de categorías quedan arriba
  function scrollToMain(force = false) {
    const bar = page.querySelector('#mk-bar');
    const s = scroller();
    const base = s ? s.getBoundingClientRect().top : 0;
    // Con force, la barra llega justo arriba de todo y se achica (logo y lupa): la lista queda pegada debajo. Con
    // 8px de aire la barra quedaba un poco más abajo, sin pegarse, y seguía grande con el buscador entero
    const top = main.getBoundingClientRect().top - base + scrollTopNow() - (bar?.offsetHeight || 0) - (force ? 0 : 8);
    if (scrollTopNow() > top || (force && Math.abs(scrollTopNow() - top) > 2)) (s || window).scrollTo({ top, behavior: 'smooth' });
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
    box.innerHTML = `<div class="mk-pairs-head"><div><b>Combiná con</b><span>${esc(displayName(p.name))}</span></div><button data-act="close-pairs" aria-label="Cerrar">${icon('close', 16)}</button></div>
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
    if (searchText) saveRecent(searchText);
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
    if (t.closest('#mk-share')) { if (ctx.onShare) ctx.onShare(comercio); return; }
    if (t.closest('#mk-fav')) { toggleFavStore(); return; }
    if (t.closest('#mk-rate')) { if (ctx.onRate) ctx.onRate(comercio); return; }
    const scrollBtn = t.closest('[data-scroll]');
    if (scrollBtn) {
      const row = scrollBtn.parentElement.querySelector('.mk-row');
      row.scrollBy({ left: Number(scrollBtn.dataset.scroll) * row.clientWidth * 0.85, behavior: 'smooth' });
      return;
    }
    if (t.closest('[data-act="close-pairs"]')) { hidePairs(); return; }
    if (t.closest('[data-rubros]')) { hideSuggest(); openRubros(); return; }
    if (t.closest('#mk-suggest')) return; // las sugerencias se atienden al apretar (mousedown)
    const goBtn = t.closest('[data-go]');
    if (goBtn) { hideSuggest(); go(goBtn.dataset.go); return; }
    const jumpBtn = t.closest('[data-jump]');
    if (jumpBtn) { jumpTo(jumpBtn.dataset.jump); return; }
    const subBtn = t.closest('[data-sub]');
    if (subBtn) { openSub(subBtn.dataset.sub); return; }
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
    if (searchText) saveRecent(searchText);
    openProductModal(p, comercioId, comercio.name, isOpenNow());
  });

  function goBack() {
    if (window.history.length > 1) {
      const before = window.location.hash;
      window.history.back();
      setTimeout(() => { if (window.location.hash === before) window.location.hash = '#/'; }, 400);
    } else window.location.hash = '#/';
  }

  // ─── hoja "Categorías": todos, de la A a la Z, con buscador que también encuentra subrubros
  let rubros = null;
  function rubrosListHtml(q) {
    const sorted = visibleTops().slice().sort((a, b) => String(a.name).localeCompare(String(b.name), 'es'));
    const rows = [];
    sorted.forEach((t) => {
      const subs = subsOf(t.id);
      const img = topImage(t);
      // Sin lazy: la hoja está oculta hasta que se abre y las fotos tienen que estar listas para entonces
      const pic = img ? `<img src="${esc(img)}" alt="" decoding="async" />` : icon('grid', 18);
      if (!q || norm(t.name).includes(q)) {
        const hint = subs.slice(0, 4).map((s) => s.name).join(', ') + (subs.length > 4 ? '…' : '');
        rows.push(`<button class="mk-rubro" data-go="cat:${esc(t.id)}"><span class="mk-rubro-pic">${pic}</span><span class="mk-rubro-txt"><b>${esc(t.name)}</b>${hint ? `<small>${esc(hint)}</small>` : ''}</span>${icon('chevronRight', 16)}</button>`);
      }
      if (q) subs.filter((s) => norm(s.name).includes(q)).forEach((s) => {
        rows.push(`<button class="mk-rubro" data-go="cat:${esc(t.id)}" data-sub-after="${esc(s.id)}"><span class="mk-rubro-pic">${pic}</span><span class="mk-rubro-txt"><b>${esc(s.name)}</b><small>en ${esc(t.name)}</small></span>${icon('chevronRight', 16)}</button>`);
      });
    });
    return rows.join('') || `<div class="mk-rubros-empty">Ninguna categoría se llama así.<button class="mk-chip is-small" data-find>${icon('search', 13)} Buscarlo entre los productos</button></div>`;
  }
  // La hoja queda armada (oculta) desde que carga la tienda y abrir solo la hace subir: crearla al tocar, con sus
  // fotos, hacía parpadear la pantalla en el celular (capa nueva sobre el panel de la tienda)
  let sheet = null;
  function buildSheet() {
    if (sheet) return sheet;
    const el = document.createElement('div');
    el.className = 'mk-rubros';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Categorías');
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = `<div class="mk-rubros-bg" data-close></div>
      <div class="mk-rubros-card">
        <header><span class="mk-rubros-handle" aria-hidden="true"></span><h2>Categorías <small></small></h2><button class="mk-rubros-x" data-close aria-label="Cerrar">${icon('close', 16)}</button></header>
        <label class="mk-search">${icon('search', 17)}<input type="search" placeholder="Buscar una categoría (ej. gaseosas)" autocomplete="off" /></label>
        <div class="mk-rubros-list"></div>
      </div>`;
    document.body.appendChild(el);
    const input = el.querySelector('input');
    const list = el.querySelector('.mk-rubros-list');
    input.addEventListener('input', () => { list.innerHTML = rubrosListHtml(norm(input.value.trim())); list.scrollTop = 0; });
    el.addEventListener('click', (e) => {
      if (!rubros) return;
      if (e.target.closest('[data-close]')) { closeRubros(); return; }
      // Al elegir, la hoja se cierra con su "atrás" y lo elegido se aplica después, sobre el paso de la tienda
      if (e.target.closest('[data-find]')) {
        const q = input.value.trim();
        closeRubros(false, () => {
          navTo(() => { searchOpen = true; searchText = q; });
          render(); scrollToMain(); runSearch();
        });
        return;
      }
      const row = e.target.closest('[data-go]');
      if (!row) return;
      if (menu) { closeRubros(false, () => jumpTo(row.dataset.go.slice(4))); return; }
      closeRubros(false, () => go(row.dataset.go, { sub: row.dataset.subAfter || '' }));
    });
    sheet = { el, input, list, html: '' };
    fillSheet();
    return sheet;
  }
  // La lista al día (los rubros llegan o cambian con los datos nuevos); no se toca si no cambió
  function fillSheet() {
    if (!sheet || rubros) return;
    const html = rubrosListHtml('');
    sheet.el.querySelector('h2 small').textContent = visibleTops().length;
    if (sheet.input.value) sheet.input.value = '';
    if (html !== sheet.html) { sheet.list.innerHTML = html; sheet.html = html; }
    sheet.list.scrollTop = 0;
  }
  function openRubros() {
    if (rubros) return;
    const { el } = buildSheet();
    fillSheet();
    el.setAttribute('aria-hidden', 'false');
    el.classList.add('is-open');
    // El botón "atrás" del celular cierra la hoja y no la tienda (la hoja agrega su propio paso)
    const onPop = () => closeRubros(true);
    saveScroll();
    window.history.pushState({ mkRubros: true }, '');
    window.addEventListener('popstate', onPop);
    const onKey = (e) => { if (e.key === 'Escape') closeRubros(); };
    document.addEventListener('keydown', onKey);
    rubros = { el, onPop, onKey };
  }
  // then: lo que se eligió en la hoja, que corre cuando el "atrás" de la hoja ya volvió al paso de la tienda
  function closeRubros(fromPop = false, then = null) {
    if (!rubros) return;
    const { el, onPop, onKey } = rubros;
    rubros = null;
    window.removeEventListener('popstate', onPop);
    document.removeEventListener('keydown', onKey);
    if (!fromPop && window.history.state?.mkRubros) {
      if (then) window.addEventListener('popstate', () => setTimeout(then, 0), { once: true });
      window.history.back();
    } else if (then) then();
    el.classList.remove('is-open');
    el.setAttribute('aria-hidden', 'true');
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
  // Las últimas búsquedas de esta persona en este comercio (en su celular): en un kiosco se compra casi siempre lo mismo
  const RECENT_KEY = `gd_mk_recent_${comercioId}`;
  function recentSearches() {
    try { return (JSON.parse(localStorage.getItem(RECENT_KEY) || '[]') || []).filter((x) => typeof x === 'string').slice(0, 5); } catch (e) { return []; }
  }
  function saveRecent(text) {
    const q = String(text || '').trim();
    if (q.length < 2) return;
    const n = norm(q);
    // "fer" y después "fernet": queda solo "fernet"
    const list = [q, ...recentSearches().filter((x) => { const m = norm(x); return m !== n && !n.startsWith(m); })].slice(0, 5);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch (e) { /* sin almacenamiento */ }
  }
  function showSuggest() {
    const box = page.querySelector('#mk-suggest');
    if (!box || searchText) return;
    const recent = recentSearches();
    const pop = popularSearches();
    if (!pop.length && !recent.length) { box.hidden = true; return; }
    box.innerHTML = (recent.length ? `<b>Tus búsquedas<button data-clear-recent>Borrar</button></b><div>${recent.map((q) => `<button class="mk-chip is-small is-recent" data-recent="${esc(q)}">${icon('clock', 13)} ${esc(q)}</button>`).join('')}</div>` : '')
      + (pop.length ? `<b>Lo que más se busca</b><div>${pop.map((c) => `<button class="mk-chip is-small" data-go="cat:${esc(c.parentCategoryId || c.id)}" data-sub-after="${c.parentCategoryId ? esc(c.id) : ''}">${esc(c.name)}</button>`).join('')}</div>` : '');
    box.hidden = false;
  }
  function setSearch(text) {
    navTo(() => { searchText = text; });
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
      hideSuggest();
      const had = !!searchText;
      searchOpen = false;
      if (had) { navTo(() => { searchText = ''; }); render(); } else page.querySelector('#mk-bar').classList.remove('is-searching');
    });
    const input = page.querySelector('#mk-search');
    const clear = page.querySelector('#mk-search-clear');
    input.addEventListener('focus', showSuggest);
    input.addEventListener('blur', () => { if (searchText.length >= 3) saveRecent(searchText); setTimeout(hideSuggest, 200); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveRecent(searchText); input.blur(); } });
    input.addEventListener('input', () => {
      setSearch(input.value.trim());
      clear.style.display = searchText ? 'flex' : 'none';
      if (searchText) hideSuggest(); else showSuggest();
      clearTimeout(debounce);
      debounce = setTimeout(() => { if (searchText) { scrollToMain(); runSearch(); } else renderMain(); }, 220);
    });
    clear.addEventListener('click', (e) => { e.preventDefault(); input.value = ''; setSearch(''); clear.style.display = 'none'; renderMain(); input.focus(); showSuggest(); });
  }
  // Las sugerencias llevan al subrubro, no solo al rubro
  page.addEventListener('mousedown', (e) => {
    if (e.target.closest('#mk-suggest [data-clear-recent]')) {
      e.preventDefault();
      try { localStorage.removeItem(RECENT_KEY); } catch (err) { /* sin almacenamiento */ }
      showSuggest();
      return;
    }
    const r = e.target.closest('#mk-suggest [data-recent]');
    if (r) {
      e.preventDefault();
      const input = page.querySelector('#mk-search');
      input.value = r.dataset.recent;
      setSearch(r.dataset.recent);
      saveRecent(r.dataset.recent);
      page.querySelector('#mk-search-clear').style.display = 'flex';
      hideSuggest();
      input.blur();
      scrollToMain();
      runSearch();
      return;
    }
    const b = e.target.closest('#mk-suggest [data-sub-after]');
    if (!b) return;
    e.preventDefault();
    hideSuggest();
    go(b.dataset.go, { sub: b.dataset.subAfter || '' });
  });

  // Barra fija: al bajar se achica (solo el nombre, el buscador y los rubros)
  const onScroll = () => {
    const bar = page.querySelector('#mk-bar');
    if (!bar) return;
    const s = scroller();
    bar.classList.toggle('is-stuck', bar.getBoundingClientRect().top <= (s ? s.getBoundingClientRect().top : 0) + 1);
    // Las subcategorías quedan pegadas debajo de la barra
    page.style.setProperty('--mk-bar-h', `${bar.offsetHeight}px`);
    spySub();
  };
  // capture: también el scroll del panel donde se abre la tienda
  document.addEventListener('scroll', onScroll, { passive: true, capture: true });

  // Cantidades al día en las tarjetas cuando cambia el carrito (también desde la ficha o el carrito)
  async function toggleFavStore() {
    const btn = page.querySelector('#mk-fav');
    const on = !isFavStore();
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-pressed', String(on));
    if (navigator.vibrate) navigator.vibrate(10);
    await toggleProductFavorite(comercioId);
    showToast(on ? `Guardaste ${comercio.name} en favoritos` : 'Lo sacaste de favoritos', 'success');
  }
  // El costo de envío llega después (cart.js lo calcula con la dirección)
  const unsubFees = subscribe('dynamicDeliveryFees', () => {
    const el = page.querySelector('#mk-fee');
    if (!el) return;
    const t = feeText();
    el.innerHTML = t;
    el.hidden = !t;
  });

  const unsubCart = subscribe('cart', () => {
    page.querySelectorAll('.mk-card').forEach((card) => {
      const p = byId.get(card.dataset.pid);
      const cta = card.querySelector('.mk-cta');
      if (p && cta) cta.innerHTML = stepperHtml(p);
    });
  });

  // Volviendo a la tienda (del carrito, por ejemplo): la categoría o búsqueda en la que estaba, en el mismo lugar
  const back = history.state;
  if (back && back.mkNav === comercioId && back.v) {
    view = back.v; searchText = back.q || ''; searchOpen = !!searchText;
    if (view.type === 'cat') loadCategory(view.id);
  }
  render();
  if (back && back.mkNav === comercioId) { if (searchText) runSearch(); if (back.y != null) restoreScroll(back.y); }
  loadCombos();
  loadTopSellers();
  loadReorder();
  // La hoja "Categorías" se arma apenas se acomoda la tienda, así al tocarla ya está lista
  const sheetTimer = setTimeout(() => { if (manyTops()) buildSheet(); }, 1200);

  return {
    /** Datos nuevos (de la base, después de la carga rápida desde el caché) */
    update(next) {
      loaded = true;
      comercio = next.comercio || comercio;
      categories = next.categories || categories;
      offers = next.activeOffers || offers;
      merge((next.products || []).map((p) => ({ id: p.id, data: () => p })));
      best = bestThreshold();
      render();
      fillSheet();
    },
    cleanup() {
      unsubCart();
      unsubFees();
      closeRubros(true);
      if (sheet) sheet.el.remove();
      clearTimeout(sheetTimer);
      window.removeEventListener('popstate', onNavPop);
      clearTimeout(jumping);
      document.removeEventListener('scroll', onScroll, { capture: true });
      clearTimeout(pairsTimer);
    },
  };
}
