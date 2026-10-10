
import { db } from '../firebase.js';
import { collection, addDoc, serverTimestamp, doc, getDoc, query, where, getDocs, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { registerUnsubscribe } from '../utils/cleanup.js';
import { getState, setState } from '../state.js';
import { formatPrice, calculateScheduleSurcharge } from '../utils/format.js';
import { showToast } from '../components/toast.js';
import { icon } from '../utils/icons.js';
import { showModal, closeModal, showConfirm } from '../components/modal.js';
import { isLoggedIn, isAdmin } from '../auth.js';
import { showAddressPrompt } from '../components/address-modal.js';
import { getDistance, calculateDynamicFee } from '../utils/geo.js';
import { suggestPlaces, resolvePlaceByName, placeCategory, nearestCategoryOf, nearestLabel, categoryLabel, mandadoStoresOf, getPlaces, normalizePlaceName } from '../utils/mandado-places.js';
import { loadMandadoPlaces } from '../utils/mandado-places-store.js';
import { goServiceHeader, goServiceHint, bindServiceHint, goServiceEmpty, closeServiceScreen, showGoInfoSheet } from '../components/service-screen.js';
import { functionUrl } from '../utils/functions-url.js';

const BANNER_STORAGE_KEY = 'godelivery_active_banner_v2';
let cachedActiveBanner = null;
let cachedLimitExceeded = false;

// Load banner from localStorage SYNCHRONOUSLY at module init — zero latency
(function loadBannerFromStorage() {
  try {
    const stored = localStorage.getItem(BANNER_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed && parsed.banner) {
        cachedActiveBanner = parsed.banner;
        cachedLimitExceeded = !!parsed.limitExceeded;
        // Preload image from disk cache immediately
        if (parsed.banner.imageUrl) {
          const img = new window.Image();
          img.src = parsed.banner.imageUrl;
        }
      }
    }
  } catch (e) { /* ignore parse errors */ }
})();

// Inject banner animation CSS once at module load to avoid render flicker
(function injectBannerStyles() {
  if (document.getElementById('gofavores-banner-style')) return;
  const s = document.createElement('style');
  s.id = 'gofavores-banner-style';
  s.textContent = `
    @keyframes bannerEntrance {
      0%   { opacity: 0; transform: translateY(14px) scale(0.96); }
      100% { opacity: 1; transform: translateY(0)   scale(1);    }
    }
    .wizard-banner-card-premium {
      animation: bannerEntrance 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.1) forwards;
      will-change: transform, opacity;
    }
  `;
  document.head.appendChild(s);
})();

// Usos con descuento de hoy (día argentino). Los cuenta el servidor en el banner al crear el
// mandado (createFavorOrder). Antes se contaban leyendo los pedidos, que la app no puede leer:
// la consulta fallaba con permission-denied y el banner no se mostraba nunca.
function bannerUsesToday(banner) {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
  return Number(banner?.stats?.discountedByDay?.[day] || 0);
}

export async function prefetchActiveBanner() {
  try {
    const bannerSnap = await getDocs(query(collection(db, 'banners_mandados'), where('status', '==', 'active')));
    let activeBanner = null;
    bannerSnap.forEach(d => {
      activeBanner = { id: d.id, ...d.data() };
    });

    if (!activeBanner) {
      cachedActiveBanner = null;
      cachedLimitExceeded = false;
      localStorage.removeItem(BANNER_STORAGE_KEY);
      return;
    }

    const todayConversions = bannerUsesToday(activeBanner);

    cachedActiveBanner = activeBanner;
    cachedLimitExceeded = activeBanner.hasDiscount && todayConversions >= activeBanner.discountLimitPerDay;

    // Persist to localStorage for instant load next time
    try {
      localStorage.setItem(BANNER_STORAGE_KEY, JSON.stringify({
        banner: activeBanner,
        limitExceeded: cachedLimitExceeded,
        cachedAt: Date.now()
      }));
    } catch (e) { /* quota exceeded, ignore */ }

    // Preload the banner image into browser cache
    if (activeBanner.imageUrl) {
      const img = new window.Image();
      img.src = activeBanner.imageUrl;
    }
  } catch (err) {
    console.error('Error prefetching active banner:', err);
  }
}

// Start prefetching immediately to refresh the stored cache
setTimeout(() => prefetchActiveBanner(), 300);

// El Mandado es lo más pedido: va arriba y directo. Encomienda y Go Cash quedan al lado, más chicos.
const MANDADO_OPTIONS = [
  { type: 'mandado', img: '/go-bag.png?v=7', title: 'Mandado' },
  { type: 'encomienda', img: '/go-pickup-point.png?v=7', title: 'Encomienda', short: 'Buscamos algo y lo llevamos' },
  { type: 'gocash', img: '/go-cash.png?v=7', title: 'Go Cash', short: 'Efectivo ↔ transferencia' },
];

// Rubros para "Lo que más se pide" cuando todavía no hay lugares aprendidos
const DEFAULT_POPULAR = ['farmacia', 'kiosco', 'verduleria', 'supermercado', 'carniceria'];
const POPULAR_ICONS = { farmacia: 'pharmacy', kiosco: 'candy', verduleria: 'vegetable', supermercado: 'supermarket', carniceria: 'meat', polleria: 'poultry', almacen: 'grocery', panaderia: 'bread', fiambreria: 'cheese', libreria: 'book', ferreteria: 'hardware', veterinaria: 'vet', heladeria: 'iceCream', bebidas: 'drink', rotiseria: 'restaurant' };

const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const escText = (v) => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

const POPULAR_MIN_VISITS = 3; // con menos compras en un rubro no alcanza para decir "lo que más se pide"

/**
 * Rubros más pedidos: solo cuentan las compras reales de mandados (visitas que registran los
 * repartidores en los lugares aprendidos). Los comercios adheridos no cuentan: dicen cuántos
 * negocios hay de un rubro, no qué pide la gente (así salían Heladería y Vinoteca). Mientras no
 * haya datos suficientes, se completa con los rubros típicos de un mandado.
 */
function popularCategories(max = 5) {
  const visits = new Map();
  getPlaces().forEach(p => {
    if (p.source !== 'aprendido') return;
    const cat = p.category || placeCategory(p.name);
    if (!cat || cat === 'pagos') return;
    visits.set(cat, (visits.get(cat) || 0) + (Number(p.visits) || 0));
  });
  const ranked = [...visits.entries()].filter(([, n]) => n >= POPULAR_MIN_VISITS).sort((a, b) => b[1] - a[1]).map(([cat]) => cat);
  DEFAULT_POPULAR.forEach(cat => { if (!ranked.includes(cat)) ranked.push(cat); });
  return ranked.slice(0, max);
}

/**
 * Últimos mandados distintos del cliente (para repetirlos con un toque).
 * Devuelve [{ stops: [{ store, items, nearest }] }].
 */
async function recentMandados(uid, max = 3) {
  const snap = await getDocs(query(collection(db, 'orders'), where('userId', '==', uid), orderBy('createdAt', 'desc'), limit(30)));
  const seen = new Set();
  const out = [];
  for (const d of snap.docs) {
    const o = d.data();
    if (!o.isFavor || o.favorType !== 'compra' || /cancel/.test(String(o.status || ''))) continue;
    const stops = mandadoStoresOf(o).map(s => ({ store: s.store, items: s.items || '', nearest: s.nearest || null }));
    if (!stops.length) continue;
    const key = stops.map(s => `${normalizePlaceName(s.store)}:${normalizePlaceName(s.items)}`).join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ stops });
    if (out.length >= max) break;
  }
  return out;
}

// Mandados: a service page. The list of options and the chosen form sit side by side; the
// form comes in from the right and back (header arrow or Android back) returns to the list.
export async function renderGoFavores(content) {
  if (!content) content = document.getElementById('app-content');
  if (!content) return;
  // El router a veces dibuja la pantalla dos veces seguidas (al terminar de cargar la sesión). Si
  // este dibujo llega cuando su contenedor ya no está en pantalla, no hace nada: antes enganchaba
  // sus botones a los del otro dibujo y el "Cómo funciona" (y todo lo demás) se abría dos veces.
  // Por lo mismo, todo se busca dentro de `content` y no en el documento.
  if (!content.isConnected) return;
  const meta = { eyebrow: 'Te lo buscamos y te lo llevamos', title: 'Mandados', infoLabel: '¿Cómo funcionan los Mandados?' };

  const user = getState().user;
  if (!user || !isLoggedIn()) {
    content.innerHTML = `
      <div class="go-service-page">
        ${goServiceHeader({ ...meta, infoId: 'mandados-info-btn' })}
        ${goServiceEmpty({ iconName: 'user', title: 'Iniciá sesión', text: 'Para pedir un mandado necesitamos saber a quién llevárselo.', ctaLabel: 'Iniciar sesión', ctaHref: '#/profile' })}
      </div>`;
    content.querySelector('#mandados-info-btn')?.addEventListener('click', () => showGoFavoresGeneralModal());
    return;
  }

  content.innerHTML = `
    <div class="go-service-page mandados-page">
      ${goServiceHeader({ ...meta, infoId: 'mandados-info-btn', leftId: 'mandados-left-btn' })}
      <div class="mandados-track-wrap">
        <div class="mandados-track" id="mandados-track">
          <section class="mandados-pane go-service-scroll" id="mandados-list-pane">
            ${goServiceHint({ id: 'mandados-hint', storageKey: 'info_seen_gofavores_v4' })}
            <div class="go-option-list">
              <div class="go-drivers-closed" id="mandados-drivers" role="status" hidden>
                <span class="go-drivers-closed-icon">${icon('clock', 20)}</span>
                <span class="go-drivers-closed-body">
                  <strong>No hay repartidores conectados</strong>
                  <small>Por ahora no podemos tomar mandados. Probá de nuevo en un rato.</small>
                </span>
              </div>
              <button type="button" class="go-mandado-hero" data-mandado="mandado">
                <span class="go-mandado-hero-top">
                  <span class="go-option-art"><img src="/go-bag.png?v=7" alt="" /></span>
                  <span class="go-option-body">
                    <span class="go-option-title">¿Qué te compramos?</span>
                    <span class="go-option-text">En cualquier negocio del pueblo, hasta 5 paradas.</span>
                  </span>
                </span>
                <span class="go-mandado-hero-field">${icon('search', 16)} Escribí qué necesitás y dónde</span>
              </button>
              <div class="go-option-pair">
                ${MANDADO_OPTIONS.filter(o => o.type !== 'mandado').map(o => `
                  <button type="button" class="go-option go-option-mini" data-mandado="${o.type}">
                    <span class="go-option-art"><img src="${o.img}" alt="" /></span>
                    <span class="go-option-title">${o.title}</span>
                    <span class="go-option-text">${o.short}</span>
                  </button>`).join('')}
              </div>
            </div>
            <section class="go-mandados-section" id="mandados-recent" hidden>
              <h3 class="go-mandados-section-title">Volvé a pedir</h3>
              <div class="go-recent-list" id="mandados-recent-list"></div>
            </section>
            <section class="go-mandados-section" id="mandados-popular">
              <h3 class="go-mandados-section-title">Lo que más se pide</h3>
              <div class="go-chip-row" id="mandados-popular-list"></div>
            </section>
            <div id="wizard-banner-container" class="mandados-banner" style="display:none;"></div>
          </section>
          <section class="mandados-pane" id="mandados-form-pane" aria-hidden="true">
            <div id="wizard-form-target" class="mandados-form-target"></div>
          </section>
        </div>
      </div>
    </div>`;

  const track = content.querySelector('#mandados-track');
  // Al enfocar un campo, el formulario lo trae a la vista (scrollIntoView) y eso corría de costado
  // este contenedor: el formulario quedaba fuera de la pantalla. En iPhone viejos (sin overflow: clip)
  // se vuelve a poner en su lugar.
  const trackWrap = content.querySelector('.mandados-track-wrap');
  trackWrap?.addEventListener('scroll', () => { if (trackWrap.scrollLeft) trackWrap.scrollLeft = 0; });
  const formPane = content.querySelector('#mandados-form-pane');
  const target = content.querySelector('#wizard-form-target');
  const leftBtn = content.querySelector('#mandados-left-btn');
  const titleEl = content.querySelector('.go-service-title');
  const eyebrowEl = content.querySelector('.go-service-eyebrow');
  const formRenderers = { encomienda: showMandadoForm, mandado: showCompraForm, gocash: showGoCashForm };
  let currentType = null;
  let noDriversOnline = false; // lo actualiza el aviso de repartidores conectados (más abajo)

  const setHeader = (type) => {
    const option = MANDADO_OPTIONS.find(o => o.type === type);
    titleEl.textContent = option ? option.title : meta.title;
    eyebrowEl.textContent = option ? 'Mandados' : meta.eyebrow;
    leftBtn.classList.toggle('is-back', !!option);
    leftBtn.setAttribute('aria-label', option ? 'Volver a las opciones' : 'Cerrar');
  };

  const slideToForm = async (type) => {
    const render = formRenderers[type];
    if (!render) return;
    currentType = type;
    setHeader(type);
    await render(target);
    formPane.removeAttribute('aria-hidden');
    track.classList.add('is-form');
  };

  const slideToList = () => {
    if (!currentType) return false;
    currentType = null;
    setHeader(null);
    track.classList.remove('is-form');
    formPane.setAttribute('aria-hidden', 'true');
    // Drop the form once it is off-screen so a half-filled one never comes back stale.
    setTimeout(() => { if (!currentType) target.innerHTML = ''; }, 400);
    return true;
  };

  const openWithPhone = (type) => {
    if (noDriversOnline) {
      window._prefilledMandadoStops = null;
      showToast('No hay repartidores conectados. Probá de nuevo en un rato.', 'warning');
      return;
    }
    const u = getState().user || {};
    if (!u.phone || u.phone.trim() === '') {
      showConfirm({
        title: 'Falta tu celular',
        message: 'Para pedir un mandado necesitamos un celular de contacto, así el repartidor y soporte pueden comunicarse con vos.',
        confirmText: 'Agregarlo ahora',
        cancelText: 'Volver',
        onConfirm: () => {
          sessionStorage.setItem('open-phone-edit', 'true');
          location.hash = '#/profile';
        }
      });
      window._prefilledMandadoStops = null;
      return;
    }
    slideToForm(type);
  };

  content.querySelectorAll('[data-mandado]').forEach(btn => {
    btn.addEventListener('click', () => openWithPhone(btn.dataset.mandado));
  });

  // Mandado ya armado (repetir uno anterior o un rubro): el formulario abre con los comercios cargados
  const openMandadoWith = (stops) => {
    window._prefilledMandadoStops = stops;
    openWithPhone('mandado');
  };

  // Sin repartidores conectados no se puede pedir nada: se avisa y se bloquean las opciones. Antes
  // el cliente se enteraba recién al confirmar, con todo el formulario completo. No se muestra
  // cuántos hay. El contador lo mantiene el servidor (settings/driverAvailability,
  // función onDriverOnlineStatusChanged); si nunca se calculó, no se bloquea.
  const driversEl = content.querySelector('#mandados-drivers');
  const pageEl = content.querySelector('.mandados-page');
  try {
    const unsubDrivers = onSnapshot(doc(db, 'settings', 'driverAvailability'), (snap) => {
      if (!document.body.contains(driversEl)) { unsubDrivers(); return; }
      noDriversOnline = snap.exists() && !(Number(snap.data().onlineCount) > 0);
      driversEl.hidden = !noDriversOnline;
      pageEl?.classList.toggle('is-closed', noDriversOnline);
    }, () => { /* sin lectura: se deja pedir; al confirmar se vuelve a verificar */ });
    registerUnsubscribe(unsubDrivers);
  } catch (e) { /* sin conexión a la base: al confirmar se vuelve a verificar */ }

  const popularEl = content.querySelector('#mandados-popular-list');
  const renderPopular = () => {
    if (!popularEl || !document.body.contains(popularEl)) return;
    popularEl.innerHTML = popularCategories().map(cat => `
      <button type="button" class="go-chip" data-cat="${cat}">${icon(POPULAR_ICONS[cat] || 'store', 15)} ${escText(capitalize(categoryLabel(cat)))}</button>`).join('');
    popularEl.querySelectorAll('[data-cat]').forEach(b => b.addEventListener('click', () => {
      const cat = b.dataset.cat;
      openMandadoWith([{ store: nearestLabel(cat), items: '', nearest: cat }]);
    }));
  };
  renderPopular();
  loadMandadoPlaces().then(renderPopular).catch(() => {});

  const recentSec = content.querySelector('#mandados-recent');
  const recentEl = content.querySelector('#mandados-recent-list');
  const recentKey = `go_mandados_recent_${user.uid}`;
  const renderRecent = (list) => {
    if (!recentSec || !recentEl) return;
    if (!Array.isArray(list) || !list.length) { recentSec.hidden = true; return; }
    recentSec.hidden = false;
    recentEl.innerHTML = list.map((r, i) => {
      const title = r.stops.map(s => s.store).join(' + ');
      const sub = r.stops.map(s => s.items).filter(Boolean).join(' · ') || 'Sin lista cargada';
      return `
        <button type="button" class="go-recent" data-i="${i}">
          <span class="go-recent-icon">${icon('refresh', 16)}</span>
          <span class="go-recent-body">
            <span class="go-recent-title">${escText(title)}</span>
            <span class="go-recent-sub">${escText(sub)}</span>
          </span>
          <span class="go-recent-cta">Repetir</span>
        </button>`;
    }).join('');
    recentEl.querySelectorAll('[data-i]').forEach(b => b.addEventListener('click', () => openMandadoWith(list[Number(b.dataset.i)].stops)));
  };
  // Lo último conocido al instante; después se actualiza con la base
  try { renderRecent(JSON.parse(localStorage.getItem(recentKey) || 'null')); } catch (e) { /* sin almacenamiento */ }
  recentMandados(user.uid).then(list => {
    try { localStorage.setItem(recentKey, JSON.stringify(list)); } catch (e) { /* sin almacenamiento */ }
    if (document.body.contains(recentEl)) renderRecent(list);
  }).catch(err => console.warn('[Mandados] No se pudieron leer los mandados anteriores:', err?.code || err));
  leftBtn.addEventListener('click', () => {
    if (!slideToList()) closeServiceScreen();
  });
  content.querySelector('#mandados-info-btn')?.addEventListener('click', () => {
    if (currentType) showServiceInfoModal(currentType);
    else showGoFavoresGeneralModal();
  });
  bindServiceHint('mandados-hint', () => showGoFavoresGeneralModal());

  // Android back: inside a form it returns to the list instead of leaving Mandados.
  window.__goServiceBack = () => (document.body.contains(track) ? slideToList() : false);

  loadMandadosBanner(openWithPhone);

  const preselected = new URLSearchParams((window.location.hash.split('?')[1]) || '').get('tipo');
  if (preselected && formRenderers[preselected]) openWithPhone(preselected);
}

const SERVICE_INFO = {
  encomienda: {
    title: 'Encomienda',
    intro: 'El repartidor retira un paquete, documento u objeto en el punto de origen y lo lleva directo al destino que marcaste.',
    notesTitle: 'Tené en cuenta',
    notes: [
      { title: 'Tiene que viajar en moto.', text: 'Si el paquete no se puede llevar de forma segura, el repartidor puede cancelar la encomienda.' },
    ],
  },
  mandado: {
    title: 'Mandado',
    intro: 'El repartidor va a los negocios que le indiques (hasta 5 paradas), compra lo que pediste y te lo lleva a tu casa.',
    notesTitle: 'Tarifa y límites',
    notes: [
      { title: 'Tarifa de gestión:', text: 'cubre el tiempo que el repartidor pasa buscando tus productos, haciendo fila y coordinando la compra, y que adelanta el dinero.' },
      { title: 'Paradas extra:', text: 'cada negocio adicional suma una tarifa fija.' },
      { title: 'Solo lo que entra en una moto:', text: 'si algo no se puede llevar de forma segura, el repartidor puede cancelar el mandado.' },
    ],
  },
  gocash: {
    title: 'Go Cash',
    intro: 'Cambiá efectivo por transferencia o al revés. El repartidor va a tu dirección y el intercambio se hace en persona.',
    notesTitle: 'Límites',
    notes: [
      { title: 'Hasta $70.000', text: 'por operación, por seguridad tuya y del repartidor.' },
      { title: 'Transferencia en el momento:', text: 'tiene que acreditarse frente al repartidor antes de entregar el efectivo.' },
    ],
  },
};

export function showServiceInfoModal(service) {
  const info = SERVICE_INFO[service];
  if (info) showGoInfoSheet(info);
}

function showWarningModal(message) {
  const alertEl = document.createElement('div');
  alertEl.innerHTML = `
    <p style="padding: 32px 24px; text-align: center; color: var(--color-text-secondary); font-size: 15.5px; font-weight: 700; line-height: 1.6; margin: 0;">${message}</p>
    <div style="padding: 0 24px 24px;">
      <button id="alert-ok-btn" class="btn btn-primary" style="width: 100%; height: 54px; border-radius: 18px; font-weight: 900; font-size: 15px; background: var(--go-ink); color: white; border: none; cursor: pointer; box-shadow: none;">Entendido</button>
    </div>
  `;
  const alertModal = showModal({
    title: 'Datos Incompletos',
    content: alertEl,
    hideHeader: false,
    height: 'auto'
  });
  alertEl.querySelector('#alert-ok-btn').onclick = () => alertModal.close();
}

export async function showMandadoForm(targetContainer = null) {
  const { geocodeAddress, getDistance, calculateDynamicFee } = await import('../utils/geo.js');
  const user = getState().user;
  const currentAddress = '';

  const modalEl = document.createElement('div');
  modalEl.style.cssText = 'padding: 14px 18px calc(18px + max(var(--safe-area-inset-bottom, 0px), env(safe-area-inset-bottom, 12px))); background: var(--color-bg); display: flex; flex-direction: column; gap:12px; box-sizing: border-box; overflow: hidden; height: 100%; flex: 1; min-height: 0;';
  modalEl.innerHTML = `
    <div style="display: flex; flex-direction: column; height: 100%; flex: 1; min-height: 0;">
      <!-- Paso 1 Container -->
      <div id="step-1-container" style="display: flex; flex-direction: column; gap: 10px; height: 100%; flex: 1; min-height: 0; justify-content: space-between; overflow:hidden;">
        <!-- Scrollable fields -->
        <div style="display: flex; flex-direction: column; gap: 12px; scrollbar-width: none; flex: 1; overflow-y: auto; -webkit-overflow-scrolling:touch; min-height: 0; padding-bottom: 24px;">

          <!-- Origen: ¿Dónde recogemos? -->
          <div style="display:flex; flex-direction:column; gap:6px;">
            <label style="font-size: 10.5px; font-weight: 900; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing:0.5px;">Origen: ¿Dónde recogemos?</label>
            <button id="pickup-addr-btn" style="width: 100%; height: 44px; border-radius: 14px; border: 1.5px solid var(--color-border-light); padding: 0 12px; background: var(--color-surface); font-size: 13px; font-weight: 700; display:flex; align-items:center; gap:8px; text-align:left; color:var(--color-text-secondary); cursor:pointer; transition:all 0.2s; box-shadow: var(--shadow-sm);">
               <div style="width:28px; height:28px; border-radius:8px; background:rgba(var(--color-primary-rgb),0.1); color:var(--color-primary); display:flex; align-items:center; justify-content:center; flex-shrink:0;">${icon('mapPin', 16)}</div>
               <span id="pickup-text" style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">Elegir dirección en el mapa...</span>
               ${icon('chevronRight', 16)}
            </button>
            <input type="text" id="pickup-details" placeholder="Detalle: Nro, depto, timbre, local o ref (Obligatorio)" style="height:38px; border-radius:12px; border:1.5px solid var(--color-border-light); padding:0 12px; background:var(--color-surface); color:var(--color-text-primary); font-size:12.5px; font-weight:600; outline:none; transition:all 0.2s;" />
          </div>

          <!-- Detalles de la Encomienda -->
          <div style="display:flex; flex-direction:column; gap:6px;">
            <label style="font-size: 10.5px; font-weight: 900; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing:0.5px; display:block;">Detalles de la Encomienda</label>
            <textarea id="favor-details" placeholder="Ej: Recoger llaves en el portero y traerlas. Contacto: Juan 123456..." style="width: 100%; height: 80px; border-radius: 14px; border: 1.5px solid var(--color-border-light); padding: 10px 12px; background: var(--color-surface); color: var(--color-text-primary); font-size: 12.5px; font-weight: 600; resize: none; outline:none; font-family:inherit; transition:all 0.2s;"></textarea>
          </div>

          <!-- Destino de Entrega -->
          <div style="display:flex; flex-direction:column; gap:6px; margin-top:2px;">
            <label style="font-size: 10.5px; font-weight: 900; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing:0.5px;">Destino: ¿Dónde entregamos?</label>
            <button id="delivery-addr-btn" style="width: 100%; height: 44px; border-radius: 14px; border: 1.5px solid var(--color-border-light); padding: 0 12px; background: var(--color-surface); font-size: 13px; font-weight: 700; display:flex; align-items:center; gap:8px; text-align:left; color:var(--color-text-primary); cursor:pointer; transition:all 0.2s; box-shadow: var(--shadow-sm);">
               <div style="width:28px; height:28px; border-radius:8px; background:var(--go-paper-2); color:var(--go-text); display:flex; align-items:center; justify-content:center; flex-shrink:0;">${icon('home', 16)}</div>
               <span id="delivery-text" style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${currentAddress || 'Elegir destino...'}</span>
               ${icon('chevronUp', 16)}
            </button>
            <input type="text" id="delivery-details" value="${currentAddress ? (getState().addressNotes || '') : ''}" placeholder="Detalle: Nro, depto, timbre, local o ref (Obligatorio)" style="height:38px; border-radius:12px; border:1.5px solid var(--color-border-light); padding:0 12px; background:var(--color-surface); color:var(--color-text-primary); font-size:12.5px; font-weight:600; outline:none; transition:all 0.2s;" />
          </div>
        </div>

        <!-- Botón Siguiente -->
        <button type="button" id="step-1-next-btn" style="width: 100%; height: 50px; border-radius: 16px; background: var(--go-ink); color: white; border: none; font-weight: 900; font-size: 14px; cursor: pointer; text-transform: uppercase; letter-spacing: 0.05em; display: flex; align-items: center; justify-content: center; gap: 10px; margin-top: 4px; flex-shrink: 0; box-shadow: none;">
          Siguiente ${icon('chevronRight', 16)}
        </button>
      </div>

      <!-- Paso 2 Container -->
      <div id="step-2-container" style="display: none; flex-direction: column; gap: 16px; height: 100%; flex: 1; min-height: 0; justify-content: space-between;">
        <div style="display: flex; flex-direction: column; gap: 16px; scrollbar-width: none; flex: 1; overflow-y: auto; min-height: 0; padding-bottom: 12px;">
          <button type="button" id="step-2-back-btn" style="background:transparent; border:none; color:var(--color-primary); font-weight:800; cursor:pointer; display:flex; align-items:center; gap:4px; padding:8px 0; font-size:13px; outline:none; text-align:left; width:fit-content;">
            ${icon('chevronLeft', 16)} Volver a Paso 1
          </button>

          <!-- Método de pago -->
          <div style="display:flex; flex-direction:column; gap:8px;">
            <label style="font-size: 11px; font-weight: 900; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing:0.5px;">Método de Pago del Envío</label>
            <div style="display:flex; background:var(--color-bg-secondary); padding:4px; border-radius:16px; border:1.5px solid var(--color-border-light);">
              <button type="button" id="mandado-pay-efectivo" style="flex:1; height:42px; border-radius:12px; border:none; font-size:13px; font-weight:800; cursor:pointer; transition:all 0.2s; background:transparent; color:var(--color-text-secondary); display:flex; align-items:center; justify-content:center; gap:6px;">
                ${icon('dollarSign', 14)} Efectivo
              </button>
              <button type="button" id="mandado-pay-transfer" style="flex:1; height:42px; border-radius:12px; border:none; font-size:13px; font-weight:800; cursor:pointer; transition:all 0.2s; background:transparent; color:var(--color-text-secondary); display:flex; align-items:center; justify-content:center; gap:6px;">
                ${icon('creditCard', 14)} Transferencia
              </button>
            </div>
          </div>

          <!-- Benefits Container -->
          <div id="benefits-container"></div>
          
          <div id="cost-preview" style="background: var(--color-bg-secondary); padding: 16px; border-radius: 20px; display: none; flex-direction:column; gap:8px; border:1px solid var(--color-border-light); margin-top:auto;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span style="font-weight: 600; color: var(--color-text-secondary); font-size: 12px;">Envío (distancia)</span>
              <span id="dist-cost" style="font-size: 13px; font-weight: 700; color: var(--color-text-primary);">$ 0</span>
            </div>
            <div id="mandado-rain-row" style="display:none; justify-content:space-between; align-items:center;">
              <span style="font-weight: 600; color: var(--color-text-secondary); font-size: 12px; display:flex; align-items:center; gap:4px;">
                ${icon('cloudRain', 14)} Recargo por Lluvia
              </span>
              <span id="mandado-rain-cost" style="font-size: 13px; font-weight: 700; color: var(--color-text-secondary);">$ 0</span>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span style="font-weight: 600; color: var(--color-text-secondary); font-size: 12px;">Tarifa servicio</span>
              <span id="service-cost" style="font-size: 13px; font-weight: 700; color: var(--color-text-primary);">$ 0</span>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:4px; padding-top:8px; border-top:1px dashed var(--color-border-light);">
              <span style="font-weight: 900; color: var(--color-primary); font-size: 15px;">Total Servicio</span>
              <span id="estimated-cost" style="font-size: 20px; font-weight: 950; color: var(--color-primary);">$ 0</span>
            </div>
            <p style="font-size: 10px; color: var(--color-text-tertiary); margin-top: 8px; font-weight: 600; text-align: center;">
              * Este es el costo por el servicio de envío.
            </p>
          </div>
        </div>

        <button id="confirm-favor-btn" style="width: 100%; height: 56px; border-radius: 18px; background: var(--go-ink); color: white; border: none; font-weight: 900; font-size: 15px; cursor: pointer; box-shadow: none; text-transform: uppercase; letter-spacing: 0.05em; display: flex; align-items: center; justify-content: center; gap: 10px; margin-top: 8px; flex-shrink: 0;">
          ${icon('check', 20)} Solicitar Encomienda
        </button>
      </div>
    </div>
  `;

  if (targetContainer) {
    targetContainer.innerHTML = '';
    targetContainer.appendChild(modalEl);
  } else {
    showModal({
      title: 'Detalles de la Encomienda',
      content: modalEl,
      fullscreen: false,
      height: 'auto',
      hideHeader: false,
      headerBackground: 'var(--go-ink)',
      headerTextColor: '#ffffff'
    });
  }
  const pickupBtn = modalEl.querySelector('#pickup-addr-btn');
  const deliveryBtn = modalEl.querySelector('#delivery-addr-btn');

  const pickupText = modalEl.querySelector('#pickup-text');
  const deliveryText = modalEl.querySelector('#delivery-text');
  const detailsInput = modalEl.querySelector('#favor-details');
  const previewBox = modalEl.querySelector('#cost-preview');
  const distCostEl = modalEl.querySelector('#dist-cost');
  const serviceCostEl = modalEl.querySelector('#service-cost');
  const totalCostEl = modalEl.querySelector('#estimated-cost');

  let pickupData = null;
  let deliveryData = currentAddress ? { address: currentAddress, coords: getState().deliveryCoords } : null;
  let calculatedFee = 0;
  let appFee = 0;
  let selectedPaymentMethod = null;
  let selectedTip = 0;
  let appliedCoupon = null;

  const payEfectivoBtn = modalEl.querySelector('#mandado-pay-efectivo');
  const payTransferBtn = modalEl.querySelector('#mandado-pay-transfer');

  const benefitsContainer = modalEl.querySelector('#benefits-container');
  renderBenefitsSection(benefitsContainer, (tip, coupon) => {
    selectedTip = tip;
    appliedCoupon = coupon;
    updateCost();
  }, () => calculatedFee);

  const pickupDetailsInput = modalEl.querySelector('#pickup-details');
  const deliveryDetailsInput = modalEl.querySelector('#delivery-details');
  const favorDetailsInput = modalEl.querySelector('#favor-details');

  const updateDetailsFieldsState = () => {
    if (pickupDetailsInput) {
      if (pickupData) {
        pickupDetailsInput.disabled = false;
        pickupDetailsInput.style.opacity = '1';
        pickupDetailsInput.style.cursor = 'text';
        pickupDetailsInput.placeholder = 'Detalle: Nro, depto, timbre, local o ref (Obligatorio)';
      } else {
        pickupDetailsInput.disabled = true;
        pickupDetailsInput.style.opacity = '0.6';
        pickupDetailsInput.style.cursor = 'not-allowed';
        pickupDetailsInput.placeholder = 'Primero selecciona el origen...';
      }
    }

    if (deliveryDetailsInput) {
      if (deliveryData) {
        deliveryDetailsInput.disabled = false;
        deliveryDetailsInput.style.opacity = '1';
        deliveryDetailsInput.style.cursor = 'text';
        deliveryDetailsInput.placeholder = 'Detalle: Nro, depto, timbre, local o ref (Obligatorio)';
      } else {
        deliveryDetailsInput.disabled = true;
        deliveryDetailsInput.style.opacity = '0.6';
        deliveryDetailsInput.style.cursor = 'not-allowed';
        deliveryDetailsInput.placeholder = 'Primero selecciona la dirección de destino...';
      }
    }

    if (favorDetailsInput) {
      favorDetailsInput.disabled = false;
      favorDetailsInput.style.opacity = '1';
      favorDetailsInput.style.cursor = 'text';
      favorDetailsInput.placeholder = 'Ej: Recoger llaves en el portero y traerlas. Contacto: Juan 123456...';
    }
  };

  const setupScrollFocus = (el) => {
    if (!el) return;
    el.addEventListener('focus', () => {
      setTimeout(() => {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 250);
    });
  };
  setupScrollFocus(pickupDetailsInput);
  setupScrollFocus(deliveryDetailsInput);
  setupScrollFocus(favorDetailsInput);

  // Call initially to disable fields
  updateDetailsFieldsState();

  payEfectivoBtn.onclick = () => {
    selectedPaymentMethod = 'efectivo';
    payEfectivoBtn.style.background = 'var(--color-primary)';
    payEfectivoBtn.style.color = '#ffffff';
    payEfectivoBtn.style.boxShadow = 'none';
    payTransferBtn.style.background = 'transparent';
    payTransferBtn.style.color = 'var(--color-text-secondary)';
    payTransferBtn.style.boxShadow = 'none';
  };

  payTransferBtn.onclick = () => {
    selectedPaymentMethod = 'mercadopago';
    payTransferBtn.style.background = 'var(--color-primary)';
    payTransferBtn.style.color = '#ffffff';
    payTransferBtn.style.boxShadow = 'none';
    payEfectivoBtn.style.background = 'transparent';
    payEfectivoBtn.style.color = 'var(--color-text-secondary)';
    payEfectivoBtn.style.boxShadow = 'none';
  };

  const updateCost = async () => {
    if (pickupData && deliveryData) {
      try {
        const dist = await getDistance(pickupData.coords.lat, pickupData.coords.lng, deliveryData.coords.lat, deliveryData.coords.lng);
        calculatedFee = calculateDynamicFee(dist);
        
        const config = getState().servicesAppFeeConfig?.gofavor || { type: 'percentage', value: 1.2 };
        if (config.type === 'fixed') {
          appFee = config.value;
        } else {
          appFee = Math.ceil((calculatedFee * (config.value / 100)) / 10) * 10;
        }

        let couponDiscount = 0;
        if (appliedCoupon) {
          if (appliedCoupon.type === 'free_delivery') {
            couponDiscount = calculatedFee;
          } else if (appliedCoupon.discountType === 'percentage') {
            couponDiscount = Math.floor(calculatedFee * (Number(appliedCoupon.value || 0) / 100));
          } else {
            couponDiscount = Number(appliedCoupon.value || 0);
          }
        }

        const rainSurcharge = getState().isRaining ? (getState().deliveryRainSurcharge || 300) : 0;
        const nightSurcharge = calculateScheduleSurcharge(getState().nightSurchargeConfig, calculatedFee);
        const total = Math.max(calculatedFee + rainSurcharge + nightSurcharge + appFee - couponDiscount + selectedTip, 0);

        distCostEl.textContent = formatPrice(calculatedFee);
        
        const rainRow = modalEl.querySelector('#mandado-rain-row');
        const rainCostEl = modalEl.querySelector('#mandado-rain-cost');
        if (rainSurcharge > 0) {
          if (rainRow) rainRow.style.display = 'flex';
          if (rainCostEl) rainCostEl.textContent = `+ ${formatPrice(rainSurcharge)}`;
        } else {
          if (rainRow) rainRow.style.display = 'none';
        }

        serviceCostEl.textContent = formatPrice(appFee);

        let couponRow = previewBox.querySelector('.coupon-preview-row');
        const estimatedFeeRow = totalCostEl.parentElement;
        if (couponDiscount > 0) {
          if (!couponRow) {
            couponRow = document.createElement('div');
            couponRow.className = 'coupon-preview-row';
            couponRow.style.cssText = 'display:flex; justify-content:space-between; align-items:center; color:var(--go-green); font-weight:700;';
            previewBox.insertBefore(couponRow, estimatedFeeRow);
          }
          couponRow.innerHTML = `<span>Descuento cupón (${appliedCoupon.code})</span><span>-${formatPrice(couponDiscount)}</span>`;
          couponRow.style.display = 'flex';
        } else if (couponRow) {
          couponRow.style.display = 'none';
        }

        let tipRow = previewBox.querySelector('.tip-preview-row');
        if (selectedTip > 0) {
          if (!tipRow) {
            tipRow = document.createElement('div');
            tipRow.className = 'tip-preview-row';
            tipRow.style.cssText = 'display:flex; justify-content:space-between; align-items:center; color:var(--color-text-primary); font-weight:700;';
            previewBox.insertBefore(tipRow, estimatedFeeRow);
          }
          tipRow.innerHTML = `<span>Propina</span><span>+ ${formatPrice(selectedTip)}</span>`;
          tipRow.style.display = 'flex';
        } else if (tipRow) {
          tipRow.style.display = 'none';
        }

        totalCostEl.textContent = formatPrice(total);
        previewBox.style.display = 'flex';
      } catch (e) {}
    }
  };

  modalEl.querySelector('#step-1-next-btn').onclick = () => {
    const pickupDetailsInput = modalEl.querySelector('#pickup-details');
    const deliveryDetailsInput = modalEl.querySelector('#delivery-details');
    const pickupDetails = pickupDetailsInput ? pickupDetailsInput.value.trim() : '';
    const deliveryDetails = deliveryDetailsInput ? deliveryDetailsInput.value.trim() : '';

    if (!pickupData) {
      showWarningModal('Por favor, selecciona la dirección de origen (¿Dónde recogemos?)');
      return;
    }
    if (!pickupDetails) {
      showWarningModal('Por favor, ingresa el detalle de la dirección de origen (Nro, depto, ref...)');
      return;
    }
    if (!deliveryData) {
      showWarningModal('Por favor, selecciona la dirección de destino (¿Dónde entregamos?)');
      return;
    }
    if (!deliveryDetails) {
      showWarningModal('Por favor, ingresa el detalle de la dirección de destino (Nro, depto, ref...)');
      return;
    }
    if (!detailsInput.value.trim()) {
      showWarningModal('Por favor, ingresa los detalles del paquete o encomienda a enviar');
      return;
    }

    modalEl.querySelector('#step-1-container').style.display = 'none';
    modalEl.querySelector('#step-2-container').style.display = 'flex';
  };

  modalEl.querySelector('#step-2-back-btn').onclick = () => {
    modalEl.querySelector('#step-1-container').style.display = 'flex';
    modalEl.querySelector('#step-2-container').style.display = 'none';
  };

  pickupBtn.onclick = () => {
    showAddressPrompt((addr, notes, coords) => {
      pickupData = { address: addr, coords };
      pickupText.textContent = addr;
      pickupText.style.color = 'var(--color-text-primary)';
      updateDetailsFieldsState();
      
      const pickupDetailsInput = modalEl.querySelector('#pickup-details');
      if (pickupDetailsInput && notes) {
        pickupDetailsInput.value = notes;
      }
      
      updateCost();
    }, { mode: 'pick' });
  };

  deliveryBtn.onclick = () => {
    showAddressPrompt((addr, notes, coords) => {
      deliveryData = { address: addr, coords };
      deliveryText.textContent = addr;
      updateDetailsFieldsState();
      
      const deliveryDetailsInput = modalEl.querySelector('#delivery-details');
      if (deliveryDetailsInput && notes) {
        deliveryDetailsInput.value = notes;
      }
      
      updateCost();
    }, { mode: 'pick' });
  };

  modalEl.querySelector('#confirm-favor-btn').onclick = async () => {
    const pickupDetailsInput = modalEl.querySelector('#pickup-details');
    const deliveryDetailsInput = modalEl.querySelector('#delivery-details');
    const pickupDetails = pickupDetailsInput ? pickupDetailsInput.value.trim() : '';
    const deliveryDetails = deliveryDetailsInput ? deliveryDetailsInput.value.trim() : '';

    if (!selectedPaymentMethod) {
      showWarningModal('Por favor, selecciona un método de pago del envío (Efectivo o Transferencia)');
      return;
    }
    if (!pickupData) {
      showWarningModal('Por favor, selecciona la dirección de origen (¿Dónde recogemos?)');
      return;
    }
    if (!pickupDetails) {
      showWarningModal('Por favor, ingresa el detalle de la dirección de origen (Nro, depto, ref...)');
      return;
    }
    if (!deliveryData) {
      showWarningModal('Por favor, selecciona la dirección de destino (¿Dónde entregamos?)');
      return;
    }
    if (!deliveryDetails) {
      showWarningModal('Por favor, ingresa el detalle de la dirección de destino (Nro, depto, ref...)');
      return;
    }
    if (!detailsInput.value.trim()) {
      showWarningModal('Por favor, ingresa los detalles del paquete o encomienda a enviar');
      return;
    }

    if (calculatedFee === 0) {
      await updateCost();
    }

    let couponDiscount = 0;
    if (appliedCoupon) {
      if (appliedCoupon.type === 'free_delivery') {
        couponDiscount = calculatedFee;
      } else if (appliedCoupon.discountType === 'percentage') {
        couponDiscount = Math.floor(calculatedFee * (Number(appliedCoupon.value || 0) / 100));
      } else {
        couponDiscount = Number(appliedCoupon.value || 0);
      }
    }

    const rainSurcharge = getState().isRaining ? (getState().deliveryRainSurcharge || 300) : 0;
    // Same as the total shown on screen: the night surcharge was missing at confirm time.
    const nightSurcharge = calculateScheduleSurcharge(getState().nightSurchargeConfig, calculatedFee);
    const total = Math.max(calculatedFee + rainSurcharge + nightSurcharge + appFee - couponDiscount + selectedTip, 0);

    verifyDriversAndConfirm({
      title: '¿Confirmar encomienda?',
      message: `Se enviará un repartidor para realizar tu envío de encomienda.<br><br>Costo del servicio: <strong>${formatPrice(total)}</strong>`,
      onConfirm: async () => {
        try {
          const orderId = await createFavorOrder({
            type: 'mandado',
            pickupAddress: `${pickupData.address} (Detalle: ${pickupDetails})`,
            pickupCoords: pickupData.coords,
            deliveryAddress: `${deliveryData.address} (Detalle: ${deliveryDetails})`,
            deliveryCoords: deliveryData.coords,
            details: detailsInput.value.trim(),
            deliveryCost: calculatedFee,
            rainSurcharge: rainSurcharge,
            appUsageFee: appFee,
            tip: selectedTip,
            couponCode: appliedCoupon ? appliedCoupon.code : null,
            couponDiscount: couponDiscount,
            total: total,
            paymentMethod: selectedPaymentMethod
          });
          closeModal();
          setTimeout(() => {
            location.hash = `#/pedido/${orderId}`;
          }, 150);
        } catch (e) {
          console.error('Error creating Mandado favor:', e);
          showToast('Error al crear favor: ' + e.message, 'error');
        }
      }
    });
  };
}

async function checkOnlineDrivers() {
  try {
    // Las reglas de Firestore sólo permiten "list" sobre users/ a staff, así
    // que el cliente no puede contar cadetes online directamente. Leemos el
    // contador que mantiene la Cloud Function onDriverOnlineStatusChanged.
    const { doc, getDoc } = await import('firebase/firestore');
    const snap = await getDoc(doc(db, 'settings', 'driverAvailability'));
    // Si el contador todavía no se calculó nunca (recién desplegado), no
    // bloqueamos al cliente: fallamos abierto en vez de asumir 0 cadetes.
    return snap.exists() ? (snap.data().onlineCount || 0) > 0 : true;
  } catch (err) {
    console.warn('Error verifying drivers, assuming offline:', err);
    return false;
  }
}

async function verifyDriversAndConfirm(confirmOptions) {
  const hasDelivery = await checkOnlineDrivers();

  if (!hasDelivery) {
    const { showModal } = await import('../components/modal.js');
    const { close: closeAlert } = showModal({
      title: '',
      hideHeader: true,
      height: 'auto',
      content: `
        <div style="padding: 24px 20px; text-align: center; font-family: var(--font-body); display: flex; flex-direction: column; gap: 16px; color: var(--color-text-primary);">
          <div style="font-size: 44px; margin-bottom: 4px;">🛵</div>
          <h4 style="font-family: var(--font-display); font-size: 18px; font-weight: 900; margin: 0; line-height: 1.3; color: var(--color-danger);">Sin repartidores disponibles</h4>
          <p style="font-size: 13.5px; color: var(--color-text-secondary); margin: 0; line-height: 1.5; opacity: 0.95;">
            No es posible realizar tu pedido en este momento porque no hay repartidores conectados en la zona. Por favor, intenta de nuevo más tarde.
          </p>
          <button id="no-drivers-close-btn" class="btn btn-primary" style="height: 50px; width: 100%; border-radius: 14px; font-weight: 900; font-size: 14px; background: var(--go-ink); border: none; color: white; display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: none;">
            ENTENDIDO
          </button>
        </div>
      `
    });
    
    setTimeout(() => {
      const btn = document.getElementById('no-drivers-close-btn');
      if (btn) btn.onclick = () => closeAlert();
    }, 50);
    return;
  }

  if (isAdmin()) {
    const { getDocs, collection, query } = await import('firebase/firestore');
    const { db } = await import('../firebase.js');
    const { showModal, closeModal } = await import('../components/modal.js');

    const modalContent = document.createElement('div');
    modalContent.style.cssText = 'padding:24px; background:var(--color-bg); display:flex; flex-direction:column; gap:16px;';
    modalContent.innerHTML = `<div class="loader-dots" style="margin:20px auto;"><span></span><span></span><span></span></div>`;

    showModal({
      title: confirmOptions.title || 'Confirmar Pedido',
      content: modalContent
    });

    try {
      const driversSnap = await getDocs(query(collection(db, 'users')));
      const drivers = driversSnap.docs
        .map(d => ({ uid: d.id, ...d.data() }))
        .filter(u => (u.isDelivery === true || u.role === 'delivery' || u.role === 'chofer' || u.role === 'driver') && u.isOnline === true);

      modalContent.innerHTML = `
        <div style="font-size:14px; color:var(--color-text-secondary); line-height:1.5;">
          ${confirmOptions.message}
        </div>

        <div style="display:flex; flex-direction:column; gap:6px; margin-top:12px; border-top:1px solid var(--color-border-light); padding-top:12px;">
          <label style="font-size:11px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.5px;">Asignar Repartidor Directamente (Opcional Admin)</label>
          <select id="v5-create-assign-driver-select" class="select" style="width:100%; height:48px; border-radius:14px; padding:0 12px; background:var(--color-bg-card); color:var(--color-text-primary); font-size:13.5px; font-weight:600; outline:none; border:1.5px solid var(--color-border-light);">
            <option value="rotation">🔄 Rotación General (Envío a todos)</option>
            ${drivers.map(d => `
              <option value="${d.uid}">${d.displayName || d.name || 'Repartidor'} (ID: ${d.displayId || d.customId || d.userId || d.driverId || d.uid.slice(0,6)})</option>
            `).join('')}
          </select>
        </div>

        <div style="display:flex; gap:10px; margin-top:16px; border-top:1px solid var(--color-border-light); padding-top:16px;">
          <button class="btn btn-ghost" id="v5-create-cancel-btn" style="flex:1; height:48px; border-radius:14px; font-weight:800;">CANCELAR</button>
          <button class="btn btn-primary" id="v5-create-confirm-btn" style="flex:2; height:48px; border-radius:14px; font-weight:900;">CONFIRMAR</button>
        </div>
      `;

      modalContent.querySelector('#v5-create-cancel-btn').onclick = () => closeModal();
      modalContent.querySelector('#v5-create-confirm-btn').onclick = async () => {
        const select = modalContent.querySelector('#v5-create-assign-driver-select');
        window._selectedDirectDriverUid = select.value;
        closeModal();
        if (confirmOptions.onConfirm) {
          await confirmOptions.onConfirm();
        }
      };
    } catch (e) {
      console.error(e);
      modalContent.innerHTML = `<p style="color:var(--color-danger); text-align:center;">Error al cargar repartidores.</p>`;
    }
    return;
  }

  showConfirm(confirmOptions);
}

async function createFavorOrder(data) {
  const { auth } = await import('../firebase.js');
  const { doc, getDoc } = await import('firebase/firestore');
  const { db } = await import('../firebase.js');
  
  const user = auth.currentUser;
  if (!user) throw new Error('Usuario no autenticado');

  const body = {
    type: data.type,
    pickupAddress: data.pickupAddress,
    pickupCoords: data.pickupCoords,
    deliveryAddress: data.deliveryAddress,
    deliveryCoords: data.deliveryCoords,
    details: data.details,
    deliveryCost: data.deliveryCost,
    purchaseFee: data.purchaseFee || 0,
    extraStopsFee: data.extraStopsFee || 0,
    stopsCount: data.stopsCount || 1,
    appUsageFee: data.appUsageFee || 0,
    total: data.total,
    paymentMethod: data.paymentMethod,
    tip: data.tip || 0,
    couponCode: data.couponCode || null,
    couponDiscount: data.couponDiscount || 0,
    receiptDeliveryType: data.receiptDeliveryType || null,
    originBannerId: data.originBannerId || null
  };
  if (Array.isArray(data.mandadoStops) && data.mandadoStops.length) body.mandadoStops = data.mandadoStops;

  // Inject direct driver assignment if admin selected one
  const directDriverUid = window._selectedDirectDriverUid;
  if (directDriverUid && directDriverUid !== 'rotation') {
    body.directDriverUid = directDriverUid;
  }
  window._selectedDirectDriverUid = null;

  if (data.isGoCash) {
    body.isGoCash = true;
    body.goCashAmount = data.goCashAmount;
    body.goCashType = data.goCashType;
  }

  // Timeout, safe retries and no duplicate favors on a dropped connection (see order-request.js).
  const { postOrderRequest } = await import('../utils/order-request.js');
  const resData = await postOrderRequest(
    functionUrl('createFavorOrder'),
    body,
    () => user.getIdToken()
  );
  if (!resData.orderId && !resData.broadcastId) {
    throw new Error('No pudimos confirmar tu pedido. Revisá "Mis pedidos" antes de volver a intentarlo.');
  }

  // Save last address to Firestore
  return resData.orderId;
}

export async function showCompraForm(targetContainer = null) {
  const paulosConfig = getState().paulosConfig || { enabled: true, promoDeliveryFee: 1200, merchantCoveragePercent: 30 };

  const user = getState().user;
  const currentAddress = '';
  const purchaseFee = getState().favorPurchaseFee || 800;

  const modalEl = document.createElement('div');
  modalEl.style.cssText = 'padding: 12px 16px calc(14px + max(var(--safe-area-inset-bottom, 0px), env(safe-area-inset-bottom, 10px))); background: var(--color-bg); display: flex; flex-direction: column; gap: 8px; box-sizing: border-box; overflow: hidden; height: 100%; width: 100%; flex: 1; min-height: 0; position: relative;';
  modalEl.innerHTML = `
     <!-- Step Indicator -->
    <div style="display:flex; align-items:center; justify-content:center; gap:8px; flex-shrink:0; margin-bottom: 2px;">
      ${[1,2].map(n => `
        <div id="compra-step-dot-${n}" style="transition:all 0.4s cubic-bezier(0.4, 0, 0.2, 1); width:${n===1?'32px':'8px'}; height:8px; border-radius:99px; background:${n===1?'#E11D48':'rgba(225, 29, 72, 0.25)'};"></div>
      `).join('')}
    </div>

    <!-- Steps wrapper: position:relative container -->
    <div id="compra-steps-wrapper" style="position:relative; flex:1; min-height:0; width:100%; overflow:hidden; display:flex; flex-direction:column;">
      <div id="compra-steps-slides-container" style="display:flex; width:200%; height:100%; transition:transform 0.4s cubic-bezier(0.4, 0, 0.2, 1); will-change:transform;">

        <!-- ── Paso 1: Comercios, Productos y Destino de Entrega ──────────────── -->
        <div id="compra-step-1-container" style="display:flex; flex-direction:column; height:100%; width:50%; box-sizing:border-box; overflow-y:auto; -webkit-overflow-scrolling:touch; gap:10px; flex-shrink:0; padding:2px 2px 20px 2px; scrollbar-width:none;">
          <!-- Preset Banner Premium Maxikiosco Paulos -->
          <div id="kiosk-24h-compra-card" style="${paulosConfig.enabled === false ? 'display: none;' : 'display: flex;'} background: var(--go-ink); border: 1px solid var(--go-ink-line); border-radius: 20px; padding: 14px 16px; flex-direction: column; gap: 12px; margin-top: 4px; margin-bottom: 6px; box-shadow: none; position: relative; overflow: hidden; cursor: pointer; transition: all 0.3s ease;">

            <!-- Header row: Logo + Title (single line) + Badge (top right) -->
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px; z-index: 1; width: 100%;">
              <div style="display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0;">
                <div style="width: 44px; height: 44px; border-radius: 50%; overflow: hidden; border: 2px solid var(--go-ink-line); flex-shrink: 0; box-shadow: none; background: var(--go-ink-2);">
                  <img src="/paulos-logo-real.jpg?v=9" alt="Maxikiosco Paulos" style="width: 100%; height: 100%; object-fit: cover; display: block; border-radius: 50%;" />
                </div>

                <div style="display: flex; flex-direction: column; min-width: 0; flex: 1;">
                  <h3 style="font-family: var(--font-display); font-size: 14.5px; font-weight: 950; color: var(--go-on-ink); margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; letter-spacing: -0.01em;">
                    Maxikiosco Paulos
                  </h3>
                  <span style="font-size: 11px; font-weight: 700; color: var(--go-on-ink-2); margin-top: 1px;">
                    Chacabuco 451
                  </span>
                </div>
              </div>

              <span style="z-index: 1; display: inline-flex; align-items: center; gap: 6px; background: var(--go-ink-3); color: var(--go-on-ink); font-size: 9px; font-weight: 950; padding: 5px 9px; border-radius: 999px; text-transform: uppercase; letter-spacing: 0.08em; border: 1px solid var(--go-ink-line); white-space: nowrap; flex-shrink: 0;">
                <span style="width: 6px; height: 6px; border-radius: 50%; background: #22c55e;"></span> Abierto 24 hs
              </span>
            </div>

            <!-- Bottom Center Button -->
            <button type="button" style="z-index: 1; width: 100%; height: 42px; border-radius: 12px; background: var(--go-on-ink); color: var(--go-ink); border: none; font-size: 12.5px; font-weight: 950; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; box-shadow: none; text-transform: uppercase; letter-spacing: 0.05em;">
              COMPRAR EN PAULOS
            </button>
          </div>

          <div style="display:flex; flex-direction:column; gap:6px; margin-top:2px; flex-shrink:0;">
            <label style="font-size:10.5px; font-weight:900; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.5px;">¿Cuántos comercios querés visitar?</label>
            <div style="display:grid; grid-template-columns:repeat(5,1fr); gap:8px; flex-shrink:0;">
              ${[1,2,3,4,5].map(n => `
                <button type="button" class="stop-count-btn" data-stops="${n}" style="height:40px; border-radius:14px; border:1.5px solid ${n===1?'var(--color-primary)':'var(--color-border-light)'}; background:${n===1?'var(--color-primary)':'var(--color-surface)'}; color:${n===1?'#ffffff':'var(--color-text-secondary)'}; font-weight:900; font-size:14px; cursor:pointer; transition:all 0.2s; box-shadow: ${n===1?'0 4px 10px rgba(var(--color-primary-rgb, 225, 29, 72), 0.25)':'none'};">
                  ${n}
                </button>
              `).join('')}
            </div>
            <p id="extra-stop-note" style="font-size:10px; color:var(--color-text-tertiary); margin:2px 0 0; font-weight:600; display:none; line-height:1.3;">
              📍 Se cobra una parada extra por cada comercio adicional al primero.
            </p>
          </div>

          <div id="stores-subforms-container" style="display:flex; flex-direction:column; gap:10px; padding-right:2px;"></div>

          <!-- Destino de Entrega -->
          <div style="display:flex; flex-direction:column; gap:6px; flex-shrink:0; margin-top:2px;">
            <label style="font-size:10.5px; font-weight:900; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.5px;">¿Dónde entregamos?</label>
            <button id="delivery-addr-btn" type="button" style="width:100%; height:44px; border-radius:14px; border:1.5px solid var(--color-border-light); padding:0 12px; background:var(--color-surface); font-size:13px; font-weight:700; display:flex; align-items:center; gap:8px; text-align:left; color:var(--color-text-primary); cursor:pointer; transition:all 0.2s; box-shadow:var(--shadow-sm);">
              <div style="width:28px; height:28px; border-radius:8px; background:var(--go-paper-2); color:var(--go-text); display:flex; align-items:center; justify-content:center; flex-shrink:0;">${icon('home',16)}</div>
              <span id="delivery-text" style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${currentAddress||'Elegir destino...'}</span>
              ${icon('chevronUp', 16)}
            </button>
            <input type="text" id="delivery-details" value="${currentAddress?(getState().addressNotes||''):''}" placeholder="Detalle: Nro, depto, timbre, local o ref (Obligatorio)" style="height:38px; border-radius:12px; border:1.5px solid var(--color-border-light); padding:0 12px; background:var(--color-surface); color:var(--color-text-primary); font-size:12.5px; font-weight:600; outline:none; transition:all 0.2s;" />
          </div>
        </div>

        <!-- ── Paso 2: Pago + Costo ────────────────────────────────────────── -->
        <div id="compra-step-2-container" style="display:flex; flex-direction:column; gap:12px; width:50%; box-sizing:border-box; overflow-y:auto; -webkit-overflow-scrolling:touch; flex-shrink:0; height:100%; padding:2px 2px 20px 2px;">

          <div style="display:flex; flex-direction:column; gap:6px;">
            <label style="font-size:10.5px; font-weight:900; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.5px;">Método de Pago del Envío</label>
            <div style="position:relative; display:flex; background:var(--color-bg-secondary); padding:3px; border-radius:14px; border:1.5px solid var(--color-border-light); z-index:1; overflow:hidden; width:100%; height:44px; box-sizing:border-box; align-items:center;">
              <div id="compra-payment-slider" style="position:absolute; top:3px; left:3px; width:calc(50% - 3px); height:36px; background:var(--go-ink); border-radius:10px; transition:transform 0.35s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s; z-index:0; box-shadow:0 4px 12px rgba(225, 29, 72, 0.25); opacity:0; pointer-events:none;"></div>
              <button type="button" id="compra-pay-efectivo" style="position:relative; z-index:1; flex:1; height:36px; border-radius:10px; border:none; font-size:12.5px; font-weight:850; cursor:pointer; transition:all 0.3s; background:transparent; color:var(--color-text-secondary); display:flex; align-items:center; justify-content:center; gap:6px; outline:none;">
                ${icon('dollarSign',14)} Efectivo
              </button>
              <button type="button" id="compra-pay-transfer" style="position:relative; z-index:1; flex:1; height:36px; border-radius:10px; border:none; font-size:12.5px; font-weight:850; cursor:pointer; transition:all 0.3s; background:transparent; color:var(--color-text-secondary); display:flex; align-items:center; justify-content:center; gap:6px; outline:none;">
                ${icon('creditCard',14)} Transferencia
              </button>
            </div>
          </div>

          <div id="compra-benefits-container"></div>

          <div id="compra-cost-preview" style="background:var(--color-bg-secondary); padding:12px 14px; border-radius:16px; display:none; flex-direction:column; gap:8px; border:1px solid var(--color-border-light);">
            <div style="display:flex; justify-content:space-between; align-items:center; font-size:12.5px; font-weight:800; color:var(--color-text-primary);">
              <span style="display:flex; align-items:center; gap:6px;">
                Costo de Envío
                <button type="button" id="compra-info-btn" style="border:none; background:rgba(225, 29, 72, 0.08); width:20px; height:20px; border-radius:50%; padding:0; cursor:pointer; color:#E11D48; display:flex; align-items:center; justify-content:center; outline:none; transition: all 0.2s; transform: translateY(-1px);">${icon('info',12)}</button>
              </span>
              <span id="compra-summary-total" style="font-weight:900;">$ ---</span>
            </div>
            <div id="compra-rain-row" style="display:none; justify-content:space-between; align-items:center; font-size:12.5px; font-weight:800; color:var(--color-text-secondary);">
              <span style="display:flex; align-items:center; gap:6px;">${icon('cloudRain',15)} Recargo por Lluvia</span>
              <span id="compra-rain-cost" style="font-weight:900;">$ 0</span>
            </div>
            <div id="compra-banner-discount-row" style="display:none; justify-content:space-between; align-items:center; font-size:12.5px; font-weight:800; color:var(--go-green);">
              <span style="display:flex; align-items:center; gap:6px;">${icon('tag',15)} Envío Bonificado</span>
              <span id="compra-banner-discount-cost" style="font-weight:900;">-$ 0</span>
            </div>
            <div style="display:flex; justify-content:space-between; font-size:15px; font-weight:950; color:#E11D48; border-top:1.5px dashed var(--color-border-light); padding-top:10px; margin-top:2px;">
              <span>Total Servicio</span><span id="final-service-fee">$ ---</span>
            </div>
            <p style="font-size:9.5px; color:var(--color-text-tertiary); margin-top:2px; line-height:1.3; font-weight:600; text-align:center;">* El valor de los productos se abona al repartidor al recibirlos.</p>
          </div>

        </div>
      </div>
    </div>

    <!-- Hidden submit trigger targeted by footer mainBtn delegate -->
    <button id="confirm-buy-btn" style="display:none;"></button>

    <!-- ── Footer fijo: botón volver + botón acción principal (Siempre visible) ────────────── -->
    <div style="display:flex; gap:8px; flex-shrink:0; padding-top:10px; border-top:1px solid var(--color-border-light); background:var(--color-bg); z-index:10; margin-top:auto;">
      <button type="button" id="compra-back-btn" style="height:48px; width:48px; border-radius:14px; background:var(--color-bg-secondary); color:var(--color-text-primary); border:1.5px solid var(--color-border-light); font-weight:900; cursor:pointer; display:none; align-items:center; justify-content:center; flex-shrink:0; transition:all 0.2s;">
        ${icon('chevronLeft',18)}
      </button>
      <button type="button" id="compra-main-btn" style="flex:1; height:48px; border-radius:14px; background: var(--go-ink); color:white; border:none; font-weight:900; font-size:14px; cursor:pointer; text-transform:uppercase; letter-spacing:0.05em; display:flex; align-items:center; justify-content:center; gap:8px; box-shadow: none; transition:background 0.2s, box-shadow 0.2s;">
        Siguiente ${icon('chevronRight',16)}
      </button>
    </div>
  `;

  if (targetContainer) {
    targetContainer.innerHTML = '';
    targetContainer.appendChild(modalEl);
  } else {
    showModal({
      title: 'Mandado: Comprar algo',
      content: modalEl,
      fullscreen: false,
      height: '80vh',
      hideHeader: false,
      headerBackground: 'var(--go-ink)',
      headerTextColor: '#ffffff'
    });
  }

  const deliveryBtn   = modalEl.querySelector('#delivery-addr-btn');
  const deliveryText  = modalEl.querySelector('#delivery-text');
  const totalFeeEl    = modalEl.querySelector('#final-service-fee');
  const extraStopNote = modalEl.querySelector('#extra-stop-note');
  const previewBox    = modalEl.querySelector('#compra-cost-preview');
  const subformsContainer = modalEl.querySelector('#stores-subforms-container');

  const centerCoords = { lat: -35.0811, lng: -57.5146 };
  let deliveryData = currentAddress ? { address: currentAddress, coords: getState().deliveryCoords } : null;
  let calculatedDistFee = 0;
  let appFee = 0;
  let stopsCount = 1;
  const extraStopFee = getState().deliveryExtraStopFee || 500;
  let selectedPaymentMethod = null;
  let selectedTip = 0;
  let appliedCoupon = null;
  let couponDiscount = 0;
  let total = 0;

  // ── Unified step navigation with CSS transform/opacity ───────────────────
  let currentStepNum = 1;
  const STEP_IDS = ['compra-step-1-container', 'compra-step-2-container'];

  const backBtn = modalEl.querySelector('#compra-back-btn');
  const mainBtn = modalEl.querySelector('#compra-main-btn');

  const STEP_CONFIG = {
    1: { label: `Siguiente ${icon('chevronRight', 16)}`, bg: 'var(--color-primary)', shadow: 'none' },
    2: { label: `${icon('check', 18)} Solicitar Compra`, bg: 'var(--color-primary)', shadow: 'none' }
  };

  const updateFooter = (stepNum) => {
    const cfg = STEP_CONFIG[stepNum];
    mainBtn.innerHTML = cfg.label;
    mainBtn.style.background = cfg.bg;
    mainBtn.style.boxShadow = cfg.shadow;
    // Show/hide back button
    backBtn.style.display = stepNum > 1 ? 'flex' : 'none';
  };

  const updateStepDots = (activeStep) => {
    [1, 2].forEach(n => {
      const dot = modalEl.querySelector(`#compra-step-dot-${n}`);
      if (!dot) return;
      dot.style.width = n === activeStep ? '32px' : '8px';
      dot.style.background = n === activeStep ? '#E11D48' : 'rgba(225, 29, 72, 0.25)';
    });
  };

  const showStep = (targetNum) => {
    const slidesContainer = modalEl.querySelector('#compra-steps-slides-container');
    if (!slidesContainer) return;

    if (targetNum === 1) {
      slidesContainer.style.transform = 'translateX(0)';
    } else {
      slidesContainer.style.transform = 'translateX(-50%)';
    }

    currentStepNum = targetNum;
    updateStepDots(targetNum);
    updateFooter(targetNum);

    // Trigger cost calculation when arriving at step 2
    if (targetNum === 2 && deliveryData?.coords) updateCost();
  };

  // Back button: always goes to previous step
  backBtn.onclick = () => showStep(currentStepNum - 1, 'backward');

  // Main button: routes to step-specific logic
  mainBtn.onclick = () => {
    if (currentStepNum === 1) {
      // Validate step 1 (stores + products)
      const nameInputs = Array.from(subformsContainer.querySelectorAll('.store-name-input'));
      const detailTextareas = Array.from(subformsContainer.querySelectorAll('.store-detail-textarea'));
      let validated = true;
      for (let i = 0; i < stopsCount; i++) {
        const name = nameInputs[i]?.value.trim();
        const details = detailTextareas[i]?.value.trim();
        if (!name || !details) {
          validated = false;
          if (nameInputs[i]) nameInputs[i].style.borderColor = 'var(--color-primary)';
          if (detailTextareas[i]) detailTextareas[i].style.borderColor = 'var(--color-primary)';
        } else {
          if (nameInputs[i]) nameInputs[i].style.borderColor = 'var(--color-border-light)';
          if (detailTextareas[i]) detailTextareas[i].style.borderColor = 'var(--color-border-light)';
        }
      }
      if (!validated) { showWarningModal('Por favor, ingresa los nombres de los comercios y el detalle de los productos a comprar'); return; }

      // Validate delivery destination
      const deliveryDetailsInput = modalEl.querySelector('#delivery-details');
      const deliveryDetails = deliveryDetailsInput ? deliveryDetailsInput.value.trim() : '';
      if (!deliveryData) { showWarningModal('Por favor, selecciona la dirección de entrega'); return; }
      if (!deliveryDetails) { showWarningModal('Por favor, ingresa el detalle de la dirección de entrega (Nro, depto, ref...)'); return; }

      showStep(2, 'forward');
    } else if (currentStepNum === 2) {
      // Trigger confirm — delegate to confirm-buy-btn logic below
      modalEl.querySelector('#confirm-buy-btn')?.click();
    }
  };

  // Initialize footer state
  updateFooter(1);

  const infoBtn = modalEl.querySelector('#compra-info-btn');

  if (infoBtn) {
    infoBtn.onclick = async (e) => {
      e.stopPropagation();
      const { showModal } = await import('../components/modal.js');
      
      let breakdownHtml = `
        <div style="padding:10px 4px; display:flex; flex-direction:column; text-align:left;">
          <div style="font-size:12.5px; color:var(--color-text-secondary); line-height:1.5; margin-bottom:18px; font-weight:600;">
            A continuación se detalla el desglose del costo de envío para este pedido:
          </div>
          
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; font-size:13px;">
            <div style="display:flex; align-items:center; gap:10px;">
              <div style="width:28px; height:28px; border-radius:8px; background:rgba(225,29,72,0.08); color:#E11D48; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                ${icon('mapPin', 14)}
              </div>
              <span style="color:var(--color-text-secondary); font-weight:600;">Envío (distancia)</span>
            </div>
            <span style="font-weight:800; color:var(--color-text-primary);">${formatPrice(calculatedDistFee)}</span>
          </div>

          ${getState().isRaining ? `
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; font-size:13px; padding-top:12px; border-top:1px dashed var(--color-border-light);">
              <div style="display:flex; align-items:center; gap:10px;">
                <div style="width:28px; height:28px; border-radius:8px; background:var(--go-paper-2); color:var(--go-text); display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                  ${icon('cloudRain', 14)}
                </div>
                <span style="color:var(--color-text-secondary); font-weight:600;">Recargo por Lluvia</span>
              </div>
              <span style="font-weight:800; color:var(--color-text-secondary);">+ ${formatPrice(getState().deliveryRainSurcharge || 300)}</span>
            </div>
          ` : ''}

          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; font-size:13px; padding-top:12px; border-top:1px dashed var(--color-border-light);">
            <div style="display:flex; align-items:center; gap:10px;">
              <div style="width:28px; height:28px; border-radius:8px; background:var(--go-paper-2); color:var(--go-text); display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                ${icon('shoppingBag', 14)}
              </div>
              <span style="color:var(--color-text-secondary); font-weight:600;">Gestión Especial</span>
            </div>
            <span style="font-weight:800; color:var(--color-text-primary);">${formatPrice(purchaseFee)}</span>
          </div>

          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; font-size:13px; padding-top:12px; border-top:1px dashed var(--color-border-light);">
            <div style="display:flex; align-items:center; gap:10px;">
              <div style="width:28px; height:28px; border-radius:8px; background:var(--go-paper-2); color:var(--go-text); display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                ${icon('info', 14)}
              </div>
              <span style="color:var(--color-text-secondary); font-weight:600;">Servicio App</span>
            </div>
            <span style="font-weight:800; color:var(--color-text-primary);">${formatPrice(appFee)}</span>
          </div>
      `;

      if (stopsCount > 1) {
        const extraStopsTotal = (stopsCount - 1) * extraStopFee;
        breakdownHtml += `
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; font-size:13px; padding-top:12px; border-top:1px dashed var(--color-border-light);">
            <div style="display:flex; align-items:center; gap:10px;">
              <div style="width:28px; height:28px; border-radius:8px; background:var(--go-paper-2); color:var(--go-text); display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                ${icon('route', 14)}
              </div>
              <span style="color:var(--color-text-secondary); font-weight:600;">Paradas extra (×${stopsCount - 1})</span>
            </div>
            <span style="font-weight:800; color:var(--color-text-primary);">+ ${formatPrice(extraStopsTotal)}</span>
          </div>
        `;
      }

      if (appliedCoupon && couponDiscount > 0) {
        breakdownHtml += `
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; font-size:13px; padding-top:12px; border-top:1px dashed var(--color-border-light);">
            <div style="display:flex; align-items:center; gap:10px;">
              <div style="width:28px; height:28px; border-radius:8px; background:var(--go-paper-2); color:var(--go-text); display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                ${icon('tag', 14)}
              </div>
              <span style="color:var(--color-text-secondary); font-weight:600;">Descuento cupón (${appliedCoupon.code})</span>
            </div>
            <span style="font-weight:800; color:var(--go-green);">-${formatPrice(couponDiscount)}</span>
          </div>
        `;
      }

      let bannerDiscount = 0;
      const nameInputsForInfo = Array.from(subformsContainer.querySelectorAll('.store-name-input'));
      const firstStoreNameForInfo = nameInputsForInfo[0]?.value.trim();
      const matchesMerchantForInfo = firstStoreNameForInfo?.toLowerCase().includes(window._activeMandadoMerchantName?.toLowerCase() || 'impossible_string');
      if (matchesMerchantForInfo && window._activeMandadoDiscount) {
        bannerDiscount = window._activeMandadoDiscount;
      }

      if (bannerDiscount > 0) {
        breakdownHtml += `
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; font-size:13px; padding-top:12px; border-top:1px dashed var(--color-border-light);">
            <div style="display:flex; align-items:center; gap:10px;">
              <div style="width:28px; height:28px; border-radius:8px; background:var(--go-paper-2); color:var(--go-text); display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                ${icon('tag', 14)}
              </div>
              <span style="color:var(--color-text-secondary); font-weight:600;">Envío Bonificado (Publicidad)</span>
            </div>
            <span style="font-weight:800; color:var(--go-green);">-${formatPrice(bannerDiscount)}</span>
          </div>
        `;
      }

      if (selectedTip > 0) {
        breakdownHtml += `
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; font-size:13px; padding-top:12px; border-top:1px dashed var(--color-border-light);">
            <div style="display:flex; align-items:center; gap:10px;">
              <div style="width:28px; height:28px; border-radius:8px; background:var(--go-paper-2); color:var(--go-text); display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                ${icon('heart', 14)}
              </div>
              <span style="color:var(--color-text-secondary); font-weight:600;">Propina al Repartidor</span>
            </div>
            <span style="font-weight:800; color:var(--color-text-primary);">+ ${formatPrice(selectedTip)}</span>
          </div>
        `;
      }

      breakdownHtml += `
          <div style="display:flex; align-items:center; justify-content:space-between; margin-top:16px; padding-top:16px; font-size:16px; font-weight:900; color:var(--color-text-primary); border-top:2px dashed var(--color-border-light);">
            <div style="display:flex; align-items:center; gap:10px;">
              <div style="width:32px; height:32px; border-radius:10px; background:rgba(225,29,72,0.1); color:#E11D48; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                ${icon('truck', 16)}
              </div>
              <span style="font-family:var(--font-display); font-weight:900; color:var(--color-text-primary);">Total del Envío</span>
            </div>
            <span style="font-size:18px; font-weight:900; color:#E11D48;">${formatPrice(total)}</span>
          </div>
        </div>
      `;

      showModal({
        title: 'Detalle del Envío',
        height: 'auto',
        content: breakdownHtml,
        hideHeader: false,
        headerBackground: 'var(--go-ink)',
        headerTextColor: '#ffffff'
      });
    };
  }



  const payEfectivoBtn = modalEl.querySelector('#compra-pay-efectivo');
  const payTransferBtn = modalEl.querySelector('#compra-pay-transfer');

  const benefitsContainer = modalEl.querySelector('#compra-benefits-container');
  renderBenefitsSection(benefitsContainer, (tip, coupon) => {
    selectedTip = tip;
    appliedCoupon = coupon;
    updateCost();
  }, () => calculatedDistFee);

  const paymentSlider = modalEl.querySelector('#compra-payment-slider');

  payEfectivoBtn.onclick = () => {
    selectedPaymentMethod = 'efectivo';
    if (paymentSlider) {
      paymentSlider.style.opacity = '1';
      paymentSlider.style.transform = 'translateX(0)';
    }
    payEfectivoBtn.style.color = '#ffffff';
    payTransferBtn.style.color = 'var(--color-text-secondary)';
  };

  payTransferBtn.onclick = () => {
    selectedPaymentMethod = 'mercadopago';
    if (paymentSlider) {
      paymentSlider.style.opacity = '1';
      paymentSlider.style.transform = 'translateX(100%)';
    }
    payTransferBtn.style.color = '#ffffff';
    payEfectivoBtn.style.color = 'var(--color-text-secondary)';
  };

  let isPaulosPreset = false;

  const kioskCompraBtn = modalEl.querySelector('#kiosk-24h-compra-card');
  if (kioskCompraBtn) {
    kioskCompraBtn.onclick = () => {
      isPaulosPreset = true;
      const nameInput = subformsContainer.querySelector('.store-name-input');
      const detailTextarea = subformsContainer.querySelector('.store-detail-textarea');
      if (nameInput) { nameInput.value = 'Maxikiosco Paulos'; loadMandadoPlaces().then(() => pickKnownPlace(nameInput)); }
      if (detailTextarea) {
        detailTextarea.value = '';
        setTimeout(() => detailTextarea.focus(), 100);
      }
      // Reset delivery data so user chooses their own address
      if (deliveryData?.coords) {
        updateCost();
      }
      showToast('⭐ Maxikiosco Paulos seleccionado con Envío Preferencial', 'success');
    };
  }

  const placeholders = [
    { name: 'Ej: Verdulería "El Trébol"', details: 'Ej: 1kg papas, 1/2kg tomates, 1 verdeo...' },
    { name: 'Ej: Kiosco "Al Paso"', details: 'Ej: 2 alfajores de chocolate, 1 gaseosa 1.5L...' },
    { name: 'Ej: Panadería "La Unión"', details: 'Ej: 1/2 docena de facturas surtidas, 1 pan de campo...' },
    { name: 'Ej: Carnicería "Magdalena"', details: 'Ej: 1kg de asado, 1/2kg de picada común...' },
    { name: 'Ej: Farmacia "Pasteur"', details: 'Ej: 1 jabón neutro, 1 pasta dental triple acción...' }
  ];

  const setupScrollFocus = (el) => {
    if (!el) return;
    el.addEventListener('focus', () => {
      setTimeout(() => {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 250);
    });
  };

  const renderSubforms = () => {
    // 1. Preserve existing inputs and textareas before clearing
    const existingNames = Array.from(subformsContainer.querySelectorAll('.store-name-input')).map(input => input.value);
    const existingPicks = Array.from(subformsContainer.querySelectorAll('.store-name-input')).map(input => ({ ...input.dataset }));
    const existingDetails = Array.from(subformsContainer.querySelectorAll('.store-detail-textarea')).map(textarea => textarea.value);

    subformsContainer.innerHTML = '';
    for (let i = 0; i < stopsCount; i++) {
      const pl = placeholders[i] || placeholders[0];
      const prevName = existingNames[i] !== undefined ? existingNames[i] : '';
      const prevDetails = existingDetails[i] !== undefined ? existingDetails[i] : '';

      const stopDiv = document.createElement('div');
      stopDiv.style.cssText = 'display:flex; flex-direction:column; gap:8px; padding:14px; background:var(--color-surface); border-radius:18px; border:1.5px solid var(--color-border-light); box-shadow:0 4px 14px rgba(0,0,0,0.02); transition:all 0.2s;';
      stopDiv.innerHTML = `
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:2px;">
          <div style="width:20px; height:20px; border-radius:50%; background:var(--color-primary); color:white; font-size:10px; font-weight:950; display:flex; align-items:center; justify-content:center;">${i + 1}</div>
          <span style="font-size:11px; font-weight:900; color:var(--color-text-primary); text-transform:uppercase; letter-spacing:0.5px;">Parada ${i + 1}</span>
        </div>
        <input type="text" class="store-name-input" value="${prevName.replace(/"/g, '&quot;')}" placeholder="${pl.name}" autocomplete="off" style="height:40px; border-radius:12px; border:1.5px solid var(--color-border-light); padding:0 12px; background:var(--color-bg-secondary); font-size:13px; font-weight:700; outline:none; color:var(--color-text-primary); transition:all 0.2s;" required />
        <div class="store-suggest-list" style="display:none; flex-direction:column; border-radius:12px; border:1.5px solid var(--color-border-light); background:var(--color-surface); overflow:hidden;"></div>
        <div class="store-place-hint" style="display:none; align-items:center; gap:6px; font-size:11.5px; font-weight:700; color:var(--go-red); padding:0 2px;"></div>
        <textarea class="store-detail-textarea" placeholder="${pl.details}" style="width:100%; height:60px; border-radius:12px; border:1.5px solid var(--color-border-light); padding:8px 12px; background:var(--color-bg-secondary); font-size:12.5px; font-weight:600; resize:none; outline:none; color:var(--color-text-primary); font-family:inherit; transition:all 0.2s;" required>${prevDetails}</textarea>
      `;
      subformsContainer.appendChild(stopDiv);

      const nameInput = stopDiv.querySelector('.store-name-input');
      const detailTextarea = stopDiv.querySelector('.store-detail-textarea');
      setupScrollFocus(nameInput);
      setupScrollFocus(detailTextarea);
      Object.assign(nameInput.dataset, existingPicks[i] || {});
      setupStorePicker(stopDiv, nameInput);
    }
  };

  // ── Comercio del mandado: sugerencias mientras se escribe ──
  // Comercios adheridos y lugares que ya conocen los repartidores (con ubicación), y si se escribe
  // un rubro, "cualquiera, el más cercano". Si no aparece, se escribe a mano como siempre.
  loadMandadoPlaces();
  const escHtml = (v) => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const clearPick = (input) => { delete input.dataset.lat; delete input.dataset.lng; delete input.dataset.nearest; delete input.dataset.pick; };
  const showPickHint = (stopDiv, input) => {
    const hint = stopDiv.querySelector('.store-place-hint');
    if (!hint) return;
    if (input.dataset.nearest) {
      hint.innerHTML = `${icon('mapPin', 13)} El repartidor va al más cercano a tu casa`;
      hint.style.display = 'flex';
    } else if (input.dataset.lat) {
      hint.innerHTML = `${icon('mapPin', 13)} Ubicación del comercio confirmada`;
      hint.style.display = 'flex';
    } else {
      hint.style.display = 'none';
    }
  };
  function setupStorePicker(stopDiv, input) {
    const list = stopDiv.querySelector('.store-suggest-list');
    if (!list) return;
    const hide = () => { list.style.display = 'none'; };
    const choose = (opt) => {
      clearPick(input);
      input.value = opt.name;
      if (opt.nearest) input.dataset.nearest = opt.nearest;
      else if (typeof opt.lat === 'number') { input.dataset.lat = String(opt.lat); input.dataset.lng = String(opt.lng); }
      input.dataset.pick = '1';
      input.style.borderColor = 'var(--color-border-light)';
      hide();
      showPickHint(stopDiv, input);
      const details = stopDiv.querySelector('.store-detail-textarea');
      if (details && !details.value.trim()) setTimeout(() => details.focus(), 60);
      updateCost();
    };
    const render = () => {
      const q = input.value.trim();
      if (q.length < 2) { hide(); return; }
      const opts = [];
      const cat = placeCategory(q);
      if (cat) opts.push({ name: nearestLabel(cat), nearest: cat, sub: `El repartidor elige la ${categoryLabel(cat)} más cerca de tu casa` });
      suggestPlaces(q).forEach(p => opts.push({ name: p.name, lat: p.lat, lng: p.lng, sub: p.address || (p.source === 'comercio' ? 'Comercio de GoDelivery' : 'Ubicación conocida por los repartidores') }));
      if (!opts.length) { hide(); return; }
      list.innerHTML = opts.map((o, k) => `
        <button type="button" data-k="${k}" style="display:flex; align-items:center; gap:10px; width:100%; padding:10px 12px; background:transparent; border:none; ${k ? 'border-top:1px solid var(--color-border-light);' : ''} text-align:left; cursor:pointer; font-family:inherit; color:var(--color-text-primary);">
          <span style="width:28px; height:28px; border-radius:9px; background:${o.nearest ? 'rgba(225,29,72,0.08)' : 'var(--color-bg-secondary)'}; color:${o.nearest ? 'var(--go-red)' : 'var(--color-text-secondary)'}; display:flex; align-items:center; justify-content:center; flex-shrink:0;">${icon(o.nearest ? 'navigationArrow' : 'mapPin', 14)}</span>
          <span style="min-width:0; display:flex; flex-direction:column; gap:1px;">
            <span style="font-size:13px; font-weight:800; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escHtml(o.name)}</span>
            <span style="font-size:11px; font-weight:600; color:var(--color-text-tertiary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escHtml(o.sub)}</span>
          </span>
        </button>`).join('');
      list.style.display = 'flex';
      list.querySelectorAll('button[data-k]').forEach(btn => {
        // pointerdown: se elige antes de que el input pierda el foco y cierre la lista
        btn.addEventListener('pointerdown', (e) => { e.preventDefault(); choose(opts[Number(btn.dataset.k)]); });
      });
    };
    input.addEventListener('input', () => { clearPick(input); showPickHint(stopDiv, input); render(); });
    input.addEventListener('focus', () => { if (!input.dataset.pick) render(); });
    input.addEventListener('blur', () => setTimeout(hide, 150));
    showPickHint(stopDiv, input);
  }

  // Ubicación conocida para un nombre cargado solo (Paulos, banner de un comercio)
  const pickKnownPlace = (input) => {
    if (!input) return;
    clearPick(input);
    const p = resolvePlaceByName(input.value);
    if (p) { input.dataset.lat = String(p.lat); input.dataset.lng = String(p.lng); input.dataset.pick = '1'; }
    const stopDiv = input.parentElement;
    if (stopDiv) showPickHint(stopDiv, input);
  };

  renderSubforms();

  // Repetir un mandado o elegir un rubro desde la pantalla de Mandados: paradas ya cargadas.
  // Se aplica al final de esta función, cuando los botones de cantidad de comercios ya funcionan.
  const prefilledStops = Array.isArray(window._prefilledMandadoStops) ? window._prefilledMandadoStops.slice(0, 5) : null;
  window._prefilledMandadoStops = null;
  const applyPrefilledStops = () => {
    if (prefilledStops.length > 1) modalEl.querySelector(`.stop-count-btn[data-stops="${prefilledStops.length}"]`)?.click();
    const names = [...subformsContainer.querySelectorAll('.store-name-input')];
    const details = [...subformsContainer.querySelectorAll('.store-detail-textarea')];
    prefilledStops.forEach((s, i) => {
      if (!names[i]) return;
      names[i].value = s.store || '';
      if (details[i]) details[i].value = s.items || '';
      if (s.nearest) {
        clearPick(names[i]);
        names[i].dataset.nearest = s.nearest;
        names[i].dataset.pick = '1';
        showPickHint(names[i].parentElement, names[i]);
      }
    });
    loadMandadoPlaces().then(() => names.forEach((input, i) => { if (prefilledStops[i] && !prefilledStops[i].nearest) pickKnownPlace(input); }));
    // Con la lista ya escrita (repetir) no hace falta escribir; con un rubro, se escribe qué comprar
    // Recién cuando terminó de entrar el formulario (0,4 s) y sin que el foco corra la pantalla:
    // durante el deslizamiento el navegador desplazaba el carril y el formulario quedaba corrido
    const firstEmpty = details.find(d => !d.value.trim());
    if (firstEmpty) setTimeout(() => firstEmpty.focus({ preventScroll: true }), 480);
  };
  if (!(prefilledStops && prefilledStops.length) && window._prefilledMerchantName) {
    const nameInput = subformsContainer.querySelector('.store-name-input');
    const detailTextarea = subformsContainer.querySelector('.store-detail-textarea');
    if (nameInput) { nameInput.value = window._prefilledMerchantName; loadMandadoPlaces().then(() => pickKnownPlace(nameInput)); }
    if (detailTextarea) {
      setTimeout(() => detailTextarea.focus({ preventScroll: true }), 480);
    }
    window._prefilledMerchantName = null;
  }

  const deliveryDetailsInput = modalEl.querySelector('#delivery-details');
  setupScrollFocus(deliveryDetailsInput);

  modalEl.querySelectorAll('.stop-count-btn').forEach(btn => {
    btn.onclick = () => {
      modalEl.querySelectorAll('.stop-count-btn').forEach(b => {
        b.style.border = '1.5px solid var(--color-border-light)';
        b.style.background = 'var(--color-surface)';
        b.style.color = 'var(--color-text-secondary)';
        b.style.boxShadow = 'none';
      });
      btn.style.border = '1.5px solid var(--color-primary)';
      btn.style.background = 'var(--color-primary)';
      btn.style.color = '#ffffff';
      btn.style.boxShadow = '0 4px 10px rgba(var(--color-primary-rgb, 225, 29, 72), 0.25)';
      stopsCount = parseInt(btn.dataset.stops);
      extraStopNote.style.display = stopsCount > 1 ? 'block' : 'none';
      renderSubforms();
      updateCost();
    };
  });

  let hasGestion = true;
  let activePurchaseFee = purchaseFee;

  const updateCost = async () => {
    if (!deliveryData?.coords) return;
    try {
      const dist = await getDistance(centerCoords.lat, centerCoords.lng, deliveryData.coords.lat, deliveryData.coords.lng);
      calculatedDistFee = calculateDynamicFee(dist);

      const extraStopsTotal = (stopsCount - 1) * extraStopFee;
      const subtotal = calculatedDistFee + activePurchaseFee + extraStopsTotal;
      const config = getState().servicesAppFeeConfig?.gofavor || { type: 'percentage', value: 1.2 };
      if (config.type === 'fixed') {
        appFee = config.value;
      } else {
        appFee = Math.ceil((subtotal * (config.value / 100)) / 10) * 10;
      }

      couponDiscount = 0;
      if (appliedCoupon) {
        if (appliedCoupon.type === 'free_delivery') {
          couponDiscount = calculatedDistFee;
        } else if (appliedCoupon.discountType === 'percentage') {
          couponDiscount = Math.floor(calculatedDistFee * (Number(appliedCoupon.value || 0) / 100));
        } else {
          couponDiscount = Number(appliedCoupon.value || 0);
        }
      }

      // Check for Banner Discount
      let bannerDiscount = 0;
      const nameInputs = Array.from(subformsContainer.querySelectorAll('.store-name-input'));
      const firstStoreName = nameInputs[0]?.value.trim();
      const matchesMerchant = firstStoreName?.toLowerCase().includes(window._activeMandadoMerchantName?.toLowerCase() || 'impossible_string');
      if (matchesMerchant && window._activeMandadoDiscount) {
        bannerDiscount = window._activeMandadoDiscount;
      }

      const rainSurcharge = getState().isRaining ? (getState().deliveryRainSurcharge || 300) : 0;
      const nightSurcharge = calculateScheduleSurcharge(getState().nightSurchargeConfig, calculatedDistFee);
      total = Math.max(subtotal + rainSurcharge + nightSurcharge + appFee - couponDiscount - bannerDiscount + selectedTip, 0);

      const summaryTotalEl = modalEl.querySelector('#compra-summary-total');
      if (summaryTotalEl) {
        summaryTotalEl.textContent = formatPrice(calculatedDistFee + extraStopsTotal);
      }

      const rainRow = modalEl.querySelector('#compra-rain-row');
      const rainCostEl = modalEl.querySelector('#compra-rain-cost');
      if (rainSurcharge > 0) {
        if (rainRow) rainRow.style.display = 'flex';
        if (rainCostEl) rainCostEl.textContent = `+ ${formatPrice(rainSurcharge)}`;
      } else {
        if (rainRow) rainRow.style.display = 'none';
      }

      const bannerDiscountRow = modalEl.querySelector('#compra-banner-discount-row');
      const bannerDiscountCostEl = modalEl.querySelector('#compra-banner-discount-cost');
      if (bannerDiscount > 0) {
        if (bannerDiscountRow) bannerDiscountRow.style.display = 'flex';
        if (bannerDiscountCostEl) bannerDiscountCostEl.textContent = `-${formatPrice(bannerDiscount)}`;
      } else {
        if (bannerDiscountRow) bannerDiscountRow.style.display = 'none';
      }

      totalFeeEl.textContent = formatPrice(total);
      previewBox.style.display = 'flex';
    } catch (e) { console.error(e); }
  };


  deliveryBtn.onclick = () => {
    showAddressPrompt((addr, notes, coords) => {
      deliveryData = { address: addr, coords };
      deliveryText.textContent = addr;
      
      const deliveryDetailsInput = modalEl.querySelector('#delivery-details');
      if (deliveryDetailsInput && notes) {
        deliveryDetailsInput.value = notes;
      }
      
      updateCost();
    }, { mode: 'pick' });
  };

  if (deliveryData?.coords) updateCost();

  modalEl.querySelector('#confirm-buy-btn').onclick = async () => {
    const nameInputs = Array.from(subformsContainer.querySelectorAll('.store-name-input'));
    const detailTextareas = Array.from(subformsContainer.querySelectorAll('.store-detail-textarea'));
    const deliveryDetailsInput = modalEl.querySelector('#delivery-details');
    const deliveryDetails = deliveryDetailsInput ? deliveryDetailsInput.value.trim() : '';

    const stopsList = [];
    for (let i = 0; i < stopsCount; i++) {
      const name = nameInputs[i] ? nameInputs[i].value.trim() : '';
      const details = detailTextareas[i] ? detailTextareas[i].value.trim() : '';
      const ds = nameInputs[i] ? nameInputs[i].dataset : {};
      const stop = { store: name, items: details };
      const nearest = ds.nearest || nearestCategoryOf(name);
      if (nearest) stop.nearest = nearest;
      else if (ds.lat && ds.lng) { stop.lat = Number(ds.lat); stop.lng = Number(ds.lng); }
      else {
        // Escrito a mano: si es un comercio adherido, se manda su ubicación (los aprendidos se
        // buscan al momento en el panel del repartidor, así usan el punto más afinado)
        const known = resolvePlaceByName(name);
        if (known && known.source === 'comercio') { stop.lat = known.lat; stop.lng = known.lng; }
      }
      stopsList.push(stop);
    }

    if (!selectedPaymentMethod) {
      showWarningModal('Por favor, selecciona un método de pago del envío (Efectivo o Transferencia)');
      return;
    }

    if (calculatedDistFee === 0) await updateCost();

    const extraStopsTotal = (stopsCount - 1) * extraStopFee;
    const subtotal = calculatedDistFee + activePurchaseFee + extraStopsTotal;
    
    let couponDiscount = 0;
    if (appliedCoupon) {
      if (appliedCoupon.type === 'free_delivery') {
        couponDiscount = calculatedDistFee;
      } else if (appliedCoupon.discountType === 'percentage') {
        couponDiscount = Math.floor(calculatedDistFee * (Number(appliedCoupon.value || 0) / 100));
      } else {
        couponDiscount = Number(appliedCoupon.value || 0);
      }
    }

    // Check for Banner Discount
    let bannerDiscount = 0;
    let bannerId = null;
    const firstStoreName = stopsList[0]?.store?.trim();
    const matchesMerchant = firstStoreName?.toLowerCase().includes(window._activeMandadoMerchantName?.toLowerCase() || 'impossible_string');
    if (matchesMerchant && window._activeMandadoDiscount) {
      bannerDiscount = window._activeMandadoDiscount;
      bannerId = window._activeMandadoBannerId;
    }

    const rainSurcharge = getState().isRaining ? (getState().deliveryRainSurcharge || 300) : 0;
    // Same as the total shown on screen: the night surcharge was missing at confirm time.
    const nightSurcharge = calculateScheduleSurcharge(getState().nightSurchargeConfig, calculatedDistFee);
    const total = Math.max(subtotal + rainSurcharge + nightSurcharge + appFee - couponDiscount - bannerDiscount + selectedTip, 0);
    const stopsLabel = stopsCount === 1 ? '1 comercio' : `${stopsCount} comercios`;

    let packagedDetails = stopsList.map((stop, idx) => `🏪 **${idx + 1}. Comercio:** ${stop.store}\n📦 **Pedido:** ${stop.items}`).join('\n\n');
    if (!hasGestion) {
      packagedDetails += `\n\n🔄 **MODO REEMPLAZO DIRECTO:** El cliente eligió SIN GESTIÓN. Si un producto no está disponible en el comercio, reemplazalo por uno similar sin consultar por chat.`;
    }

    verifyDriversAndConfirm({
      title: '¿Confirmar compra?',
      message: `Se enviará un repartidor a realizar tu compra en <strong>${stopsLabel}</strong>.<br><br>Modalidad: <strong>${hasGestion ? 'Con Atención Personalizada' : 'Sin Gestión (Reemplazo directo)'}</strong><br>Costo del servicio: <strong>${formatPrice(total)}</strong><br><br><small>* El valor de los productos se abona al repartidor al recibir el pedido.</small>`,
      onConfirm: async () => {
        try {
          const orderId = await createFavorOrder({
            type: 'compra',
            isPaulosPreset: isPaulosPreset,
            merchantCoveragePercent: paulosConfig.merchantCoveragePercent || 30,
            storeName: stopsList[0]?.store || '',
            pickupAddress: stopsCount > 1 ? `Múltiples comercios (${stopsLabel})` : `Comercio: ${stopsList[0].store}`,
            pickupCoords: centerCoords,
            deliveryAddress: `${deliveryData.address} (Detalle: ${deliveryDetails})`,
            deliveryCoords: deliveryData.coords,
            details: packagedDetails,
            mandadoStops: stopsList,
            deliveryCost: calculatedDistFee,
            rainSurcharge: rainSurcharge,
            purchaseFee: activePurchaseFee,
            extraStopsFee: extraStopsTotal,
            stopsCount: stopsCount,
            appUsageFee: appFee,
            tip: selectedTip,
            couponCode: appliedCoupon ? appliedCoupon.code : null,
            couponDiscount: couponDiscount + bannerDiscount,
            originBannerId: bannerId,
            total: total,
            paymentMethod: selectedPaymentMethod,
            includeGestion: hasGestion,
            allowDirectReplacement: !hasGestion
          });
          closeModal();
          setTimeout(() => { location.hash = `#/pedido/${orderId}`; }, 150);
        } catch (e) {
          console.error('Error creating Compra favor:', e);
          showToast('Error al crear favor: ' + e.message, 'error');
        }
      }
    });
  };

  if (prefilledStops && prefilledStops.length) applyPrefilledStops();
}

export async function showGoCashForm(targetContainer = null) {
  const { geocodeAddress, getDistance, calculateDynamicFee } = await import('../utils/geo.js');
  const user = getState().user;
  const currentAddress = '';

  const modalEl = document.createElement('div');
  modalEl.style.cssText = 'padding: 20px 24px calc(20px + max(var(--safe-area-inset-bottom, 0px), env(safe-area-inset-bottom, 16px))); background: var(--color-bg); display: flex; flex-direction: column; box-sizing: border-box; height: 100%; flex: 1; min-height: 0; overflow: hidden;';
  modalEl.innerHTML = `
    <div style="display: flex; flex-direction: column; height: 100%; flex: 1; min-height: 0; justify-content: space-between;">
      
      <!-- Paso 1 Container -->
      <div id="gocash-step-1-container" style="display: flex; flex-direction: column; gap: 16px; height: 100%; flex: 1; min-height: 0; justify-content: space-between;">
        <div style="display: flex; flex-direction: column; gap: 16px; scrollbar-width: none; flex: 1; overflow-y: auto; min-height: 0; padding-bottom: 12px;">
          <!-- Type Selector Segmented Control -->
          <div style="display:flex; flex-direction:column; gap:8px; margin-top:4px;">
            <label style="font-size: 11px; font-weight: 900; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing:0.5px;">Operación</label>
            <div style="display: flex; background: var(--color-bg-secondary); padding: 4px; border-radius: 16px; border: 1.5px solid var(--color-border-light);">
              <button id="gocash-type-c2t" class="gocash-type-btn active" style="flex: 1; height: 44px; border-radius: 12px; border: none; font-size: 11px; font-weight: 850; cursor: pointer; transition: all 0.2s; background: var(--color-surface); color: var(--color-text-primary); box-shadow: var(--shadow-sm); display:flex; align-items:center; justify-content:center; text-align:center;">
                Doy Efectivo<br/>Recibo Transf.
              </button>
              <button id="gocash-type-t2c" class="gocash-type-btn" style="flex: 1; height: 44px; border-radius: 12px; border: none; font-size: 11px; font-weight: 850; cursor: pointer; transition: all 0.2s; background: transparent; color: var(--color-text-tertiary); display:flex; align-items:center; justify-content:center; text-align:center;">
                Doy Transf.<br/>Recibo Efectivo
              </button>
            </div>
          </div>

          <!-- Amount Input -->
          <div style="display:flex; flex-direction:column; gap:8px;">
            <label style="font-size: 11px; font-weight: 900; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing:0.5px;">Monto a Cambiar (Máx $70.000)</label>
            <div style="position:relative;">
              <span style="position:absolute; left:16px; top:50%; transform:translateY(-50%); font-size:18px; font-weight:900; color:var(--color-text-tertiary);">$</span>
              <input type="number" id="gocash-amount" placeholder="0" min="1" max="70000" style="width: 100%; height: 50px; border-radius: 14px; border: 1.5px solid var(--color-border-light); padding: 0 16px 0 35px; background: var(--color-surface); color:var(--color-text-primary); font-size: 18px; font-weight: 800; outline: none; transition: all 0.2s;" />
            </div>
          </div>

          <div style="display:flex; flex-direction:column; gap:8px;">
            <label style="font-size: 11px; font-weight: 900; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing:0.5px;">¿Dónde nos encontramos?</label>
            <button id="gocash-delivery-addr-btn" style="width: 100%; height: 44px; border-radius: 14px; border: 1.5px solid var(--color-border-light); padding: 0 12px; background: var(--color-surface); font-size: 13px; font-weight: 700; display:flex; align-items:center; gap:8px; text-align:left; color:var(--color-text-primary); cursor:pointer; transition:all 0.2s; box-shadow: var(--shadow-sm);">
               <div style="width:28px; height:28px; border-radius:8px; background:var(--go-paper-2); color:var(--go-text); display:flex; align-items:center; justify-content:center; flex-shrink:0;">${icon('home', 16)}</div>
               <span id="gocash-delivery-text" style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${currentAddress || 'Elegir destino...'}</span>
               ${icon('chevronUp', 16)}
            </button>
            <input type="text" id="gocash-delivery-details" value="${currentAddress ? (getState().addressNotes || '') : ''}" placeholder="Detalle: Nro, depto, timbre, local o ref (Obligatorio)" style="height:38px; border-radius:12px; border:1.5px solid var(--color-border-light); padding:0 12px; background:var(--color-surface); color:var(--color-text-primary); font-size:12.5px; font-weight:600; outline:none; transition:all 0.2s;" />
          </div>
        </div>

        <button type="button" id="gocash-step-1-next-btn" style="width: 100%; height: 56px; border-radius: 18px; background: var(--go-ink); color: white; border: none; font-weight: 900; font-size: 15px; cursor: pointer; text-transform: uppercase; letter-spacing: 0.05em; display: flex; align-items: center; justify-content: center; gap: 10px; margin-top: 8px; flex-shrink: 0; box-shadow: none;">
          Siguiente ${icon('chevronRight', 16)}
        </button>
      </div>

      <!-- Paso 2 Container -->
      <div id="gocash-step-2-container" style="display: none; flex-direction: column; gap: 16px; height: 100%; flex: 1; min-height: 0; justify-content: space-between;">
        <div style="display: flex; flex-direction: column; gap: 16px; scrollbar-width: none; flex: 1; overflow-y: auto; min-height: 0; padding-bottom: 12px;">
          <button type="button" id="gocash-step-2-back-btn" style="background:transparent; border:none; color:var(--color-primary); font-weight:800; cursor:pointer; display:flex; align-items:center; gap:4px; padding:8px 0; font-size:13px; outline:none; text-align:left; width:fit-content;">
            ${icon('chevronLeft', 16)} Volver a Paso 1
          </button>

          <!-- Benefits Container -->
          <div id="gocash-benefits-container"></div>

          <!-- Cost Preview -->
          <div id="gocash-cost-preview" style="background: var(--color-bg-secondary); padding: 16px; border-radius: 20px; display: none; flex-direction:column; gap:8px; border:1px solid var(--color-border-light); margin-top:auto;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span style="font-weight: 600; color: var(--color-text-secondary); font-size: 12px;">Envío estimado (desde centro)</span>
              <span id="gocash-dist-cost" style="font-size: 13px; font-weight: 700; color: var(--color-text-primary);">$ 0</span>
            </div>
            <div id="gocash-rain-row" style="display:none; justify-content:space-between; align-items:center;">
              <span style="font-weight: 600; color: var(--color-text-secondary); font-size: 12px; display:flex; align-items:center; gap:4px;">
                ${icon('cloudRain', 14)} Recargo por Lluvia
              </span>
              <span id="gocash-rain-cost" style="font-size: 13px; font-weight: 700; color: var(--color-text-secondary);">$ 0</span>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span style="font-weight: 600; color: var(--color-text-secondary); font-size: 12px;">Tarifa de Servicio (App)</span>
              <span id="gocash-app-fee" style="font-size: 13px; font-weight: 700; color: var(--color-text-primary);">$ 0</span>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:4px; padding-top:8px; border-top:1px dashed var(--color-border-light);">
              <span style="font-weight: 900; color: var(--color-primary); font-size: 15px;">Total Envío Estimado</span>
              <span id="gocash-estimated-cost" style="font-size: 20px; font-weight: 950; color: var(--color-primary);">$ 0</span>
            </div>
            <p style="font-size: 10px; color: var(--color-text-tertiary); margin-top: 8px; font-weight: 600; text-align: center; line-height:1.4;">
              * Se cobra únicamente el envío. El costo final se recalculará en base a la ubicación real del repartidor al aceptar.
            </p>
          </div>
        </div>

        <button id="confirm-gocash-btn" style="width: 100%; height: 56px; border-radius: 18px; background: var(--go-ink); color: white; border: none; font-weight: 900; font-size: 15px; cursor: pointer; box-shadow: none; text-transform: uppercase; letter-spacing: 0.05em; display: flex; align-items: center; justify-content: center; gap: 10px; margin-top: 8px; flex-shrink: 0;">
          ${icon('check', 20)} Solicitar Go Cash
        </button>
      </div>
    </div>
  `;

  if (targetContainer) {
    targetContainer.innerHTML = '';
    targetContainer.appendChild(modalEl);
  } else {
    showModal({
      title: 'Solicitar Go Cash',
      content: modalEl,
      fullscreen: false,
      height: 'auto',
      hideHeader: false,
      headerBackground: 'var(--go-ink)',
      headerTextColor: '#ffffff'
    });
  }

  const btnC2t = modalEl.querySelector('#gocash-type-c2t');
  const btnT2c = modalEl.querySelector('#gocash-type-t2c');
  const amountInput = modalEl.querySelector('#gocash-amount');
  const deliveryBtn = modalEl.querySelector('#gocash-delivery-addr-btn');
  const deliveryText = modalEl.querySelector('#gocash-delivery-text');
  const previewBox = modalEl.querySelector('#gocash-cost-preview');
  const distCostEl = modalEl.querySelector('#gocash-dist-cost');
  const totalCostEl = modalEl.querySelector('#gocash-estimated-cost');
  const deliveryDetailsInput = modalEl.querySelector('#gocash-delivery-details');

  const setupScrollFocus = (el) => {
    if (!el) return;
    el.addEventListener('focus', () => {
      setTimeout(() => {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 250);
    });
  };
  setupScrollFocus(amountInput);
  setupScrollFocus(deliveryDetailsInput);

  let selectedType = 'cash_to_transfer'; // or 'transfer_to_cash'
  let deliveryData = currentAddress ? { address: currentAddress, coords: getState().deliveryCoords } : null;
  let calculatedFee = 0;
  let appFee = 0;
  let selectedTip = 0;
  let appliedCoupon = null;

  const benefitsContainer = modalEl.querySelector('#gocash-benefits-container');
  renderBenefitsSection(benefitsContainer, (tip, coupon) => {
    selectedTip = tip;
    appliedCoupon = coupon;
    updateCost();
  }, () => calculatedFee);

  btnC2t.onclick = () => {
    selectedType = 'cash_to_transfer';
    btnC2t.classList.add('active');
    btnC2t.style.background = 'var(--color-surface)';
    btnC2t.style.color = 'var(--color-text-primary)';
    btnC2t.style.boxShadow = 'var(--shadow-sm)';
    btnT2c.classList.remove('active');
    btnT2c.style.background = 'transparent';
    btnT2c.style.color = 'var(--color-text-tertiary)';
    btnT2c.style.boxShadow = 'none';
  };

  btnT2c.onclick = () => {
    selectedType = 'transfer_to_cash';
    btnT2c.classList.add('active');
    btnT2c.style.background = 'var(--color-surface)';
    btnT2c.style.color = 'var(--color-text-primary)';
    btnT2c.style.boxShadow = 'var(--shadow-sm)';
    btnC2t.classList.remove('active');
    btnC2t.style.background = 'transparent';
    btnC2t.style.color = 'var(--color-text-tertiary)';
    btnC2t.style.boxShadow = 'none';
  };

  const updateCost = async () => {
    if (deliveryData) {
      try {
        const centerCoords = { lat: -35.0811, lng: -57.5146 };
        const dist = await getDistance(centerCoords.lat, centerCoords.lng, deliveryData.coords.lat, deliveryData.coords.lng);
        calculatedFee = calculateDynamicFee(dist);

        const config = getState().servicesAppFeeConfig?.gocash || { type: 'percentage', value: 1.2 };
        if (config.type === 'fixed') {
          appFee = config.value;
        } else {
          appFee = Math.ceil((calculatedFee * (config.value / 100)) / 10) * 10;
        }

        let couponDiscount = 0;
        if (appliedCoupon) {
          if (appliedCoupon.type === 'free_delivery') {
            couponDiscount = calculatedFee;
          } else if (appliedCoupon.discountType === 'percentage') {
            couponDiscount = Math.floor(calculatedFee * (Number(appliedCoupon.value || 0) / 100));
          } else {
            couponDiscount = Number(appliedCoupon.value || 0);
          }
        }

        const rainSurcharge = getState().isRaining ? (getState().deliveryRainSurcharge || 300) : 0;
        const nightSurcharge = calculateScheduleSurcharge(getState().nightSurchargeConfig, calculatedFee);
        const total = Math.max(calculatedFee + rainSurcharge + nightSurcharge + appFee - couponDiscount + selectedTip, 0);

        distCostEl.textContent = formatPrice(calculatedFee);
        
        const rainRow = modalEl.querySelector('#gocash-rain-row');
        const rainCostEl = modalEl.querySelector('#gocash-rain-cost');
        if (rainSurcharge > 0) {
          if (rainRow) rainRow.style.display = 'flex';
          if (rainCostEl) rainCostEl.textContent = `+ ${formatPrice(rainSurcharge)}`;
        } else {
          if (rainRow) rainRow.style.display = 'none';
        }

        const appFeeEl = modalEl.querySelector('#gocash-app-fee');
        if (appFeeEl) appFeeEl.textContent = formatPrice(appFee);

        let couponRow = previewBox.querySelector('.coupon-preview-row');
        const finalFeeRow = totalCostEl.parentElement;
        if (couponDiscount > 0) {
          if (!couponRow) {
            couponRow = document.createElement('div');
            couponRow.className = 'coupon-preview-row';
            couponRow.style.cssText = 'display:flex; justify-content:space-between; align-items:center; color:var(--go-green); font-weight:700;';
            previewBox.insertBefore(couponRow, finalFeeRow);
          }
          couponRow.innerHTML = `<span>Descuento cupón (${appliedCoupon.code})</span><span>-${formatPrice(couponDiscount)}</span>`;
          couponRow.style.display = 'flex';
        } else if (couponRow) {
          couponRow.style.display = 'none';
        }

        let tipRow = previewBox.querySelector('.tip-preview-row');
        if (selectedTip > 0) {
          if (!tipRow) {
            tipRow = document.createElement('div');
            tipRow.className = 'tip-preview-row';
            tipRow.style.cssText = 'display:flex; justify-content:space-between; align-items:center; color:var(--color-text-primary); font-weight:700;';
            previewBox.insertBefore(tipRow, finalFeeRow);
          }
          tipRow.innerHTML = `<span>Propina</span><span>+ ${formatPrice(selectedTip)}</span>`;
          tipRow.style.display = 'flex';
        } else if (tipRow) {
          tipRow.style.display = 'none';
        }

        totalCostEl.textContent = formatPrice(total);
        previewBox.style.display = 'flex';
      } catch (e) {}
    }
  };

  if (deliveryData) {
    updateCost();
  }

  deliveryBtn.onclick = () => {
    showAddressPrompt((addr, notes, coords) => {
      deliveryData = { address: addr, coords };
      deliveryText.textContent = addr;
      
      const deliveryDetailsInput = modalEl.querySelector('#gocash-delivery-details');
      if (deliveryDetailsInput && notes) {
        deliveryDetailsInput.value = notes;
      }
      
      updateCost();
    }, { mode: 'pick' });
  };

  modalEl.querySelector('#gocash-step-1-next-btn').onclick = () => {
    const amount = parseFloat(amountInput.value);
    if (isNaN(amount) || amount <= 0) {
      showToast('Ingresá un monto a cambiar válido', 'warning');
      return;
    }
    if (amount > 70000) {
      showToast('El monto máximo de cambio es $70.000', 'warning');
      return;
    }
    const deliveryDetailsInput = modalEl.querySelector('#gocash-delivery-details');
    const deliveryDetails = deliveryDetailsInput ? deliveryDetailsInput.value.trim() : '';

    if (!deliveryData) {
      showWarningModal('Por favor, selecciona la dirección de entrega (¿Dónde nos encontramos?)');
      return;
    }
    if (!deliveryDetails) {
      showWarningModal('Por favor, ingresa el detalle de la dirección de entrega (Nro, depto, ref...)');
      return;
    }
    if (!selectedType) {
      showWarningModal('Por favor, selecciona un tipo de operación para Go Cash');
      return;
    }

    modalEl.querySelector('#gocash-step-1-container').style.display = 'none';
    modalEl.querySelector('#gocash-step-2-container').style.display = 'flex';
  };

  modalEl.querySelector('#gocash-step-2-back-btn').onclick = () => {
    modalEl.querySelector('#gocash-step-1-container').style.display = 'flex';
    modalEl.querySelector('#gocash-step-2-container').style.display = 'none';
  };

  modalEl.querySelector('#confirm-gocash-btn').onclick = async () => {
    const amount = parseFloat(amountInput.value);
    const deliveryDetailsInput = modalEl.querySelector('#gocash-delivery-details');
    const deliveryDetails = deliveryDetailsInput ? deliveryDetailsInput.value.trim() : '';

    if (calculatedFee === 0) {
      await updateCost();
    }

    let couponDiscount = 0;
    if (appliedCoupon) {
      if (appliedCoupon.type === 'free_delivery') {
        couponDiscount = calculatedFee;
      } else if (appliedCoupon.discountType === 'percentage') {
        couponDiscount = Math.floor(calculatedFee * (Number(appliedCoupon.value || 0) / 100));
      } else {
        couponDiscount = Number(appliedCoupon.value || 0);
      }
    }

    const rainSurcharge = getState().isRaining ? (getState().deliveryRainSurcharge || 300) : 0;
    // Same as the total shown on screen: the night surcharge was missing at confirm time.
    const nightSurcharge = calculateScheduleSurcharge(getState().nightSurchargeConfig, calculatedFee);
    const total = Math.max(calculatedFee + rainSurcharge + nightSurcharge + appFee - couponDiscount + selectedTip, 0);
    const typeText = selectedType === 'cash_to_transfer' ? 'Efectivo a Transferencia' : 'Transferencia a Efectivo';
    
    verifyDriversAndConfirm({
      title: '¿Confirmar Go Cash?',
      message: `Se enviará un repartidor para cambiar <strong>${formatPrice(amount)}</strong> (${typeText}).<br><br>Costo estimado del envío: <strong>${formatPrice(total)}</strong>`,
      onConfirm: async () => {
        try {
          const orderId = await createFavorOrder({
            type: 'gocash',
            pickupAddress: 'Ubicación del Repartidor',
            pickupCoords: { lat: -35.0811, lng: -57.5146 },
            deliveryAddress: `${deliveryData.address} (Detalle: ${deliveryDetails})`,
            deliveryCoords: deliveryData.coords,
            details: `Go Cash: Cambiar ${typeText} por valor de ${formatPrice(amount)}`,
            deliveryCost: calculatedFee + rainSurcharge,
            appUsageFee: appFee,
            tip: selectedTip,
            couponCode: appliedCoupon ? appliedCoupon.code : null,
            couponDiscount: couponDiscount,
            total: total,
            paymentMethod: selectedType,
            isGoCash: true,
            goCashAmount: amount,
            goCashType: selectedType
          });
          closeModal();
          setTimeout(() => {
            location.hash = `#/pedido/${orderId}`;
          }, 150);
        } catch (e) {
          console.error('Error creating Go Cash order:', e);
          showToast('Error al crear pedido Go Cash: ' + e.message, 'error');
        }
      }
    });
  };

}

// General "¿Cómo funcionan los Mandados?" sheet. Module-level: renderGoFavores opens it
// on first visit and from the help button (it used to live inside showGoCashForm, where
// renderGoFavores could not reach it and first-time visitors got the error screen).
function showGoFavoresGeneralModal() {
  showGoInfoSheet({
    title: 'Mandados',
    intro: 'Un repartidor hace por vos lo que necesites en el pueblo: buscar, llevar o comprar.',
    steps: [
      { title: 'Elegí qué necesitás', text: 'Encomienda, Mandado o Go Cash.' },
      { title: 'Marcá los puntos en el mapa', text: 'Dónde retiramos o compramos, y dónde te lo entregamos.' },
      { title: 'Seguilo y chateá en vivo', text: 'Ves al repartidor en el mapa y coordinás los detalles por chat.' },
    ],
  });
}

export function renderBenefitsSection(container, onUpdate, getDeliveryCost) {
  let selectedTip = 0;
  let appliedCoupon = null;

  function render() {
    container.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:12px; margin-bottom:16px;">
        <!-- Tip Pill -->
        <button type="button" id="favor-open-tip-btn" style="display:flex; align-items:center; justify-content:space-between; padding:14px 16px; background:var(--color-bg-card); border:1.5px solid ${selectedTip > 0 ? 'var(--color-primary)' : 'var(--color-border-light)'}; border-radius:18px; cursor:pointer; transition:all 0.2s; outline:none; text-align:left; width:100%; box-sizing:border-box; box-shadow: var(--shadow-sm);">
          <div style="display:flex; align-items:center; gap:12px; min-width:0;">
            <div style="width:36px; height:36px; background:${selectedTip > 0 ? 'var(--go-ink)' : 'var(--color-surface-hover)'}; color:${selectedTip > 0 ? 'white' : 'var(--color-text-secondary)'}; border-radius:12px; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
              ${icon('dollarSign', 18)}
            </div>
            <div style="min-width:0;">
              <div style="font-size:12px; font-weight:900; color:var(--color-text-primary); text-transform:uppercase; letter-spacing:0.5px;">Propina al Repartidor</div>
              <div style="font-size:11px; color:var(--color-text-secondary); opacity:0.85; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-top:2px;">
                ${selectedTip > 0 ? `Propina aplicada: ${formatPrice(selectedTip)}` : 'Apoyar repartidor'}
              </div>
            </div>
          </div>
          <div style="font-size:12px; color:var(--color-text-secondary); display:flex; align-items:center; flex-shrink:0; margin-left:4px;">
            ${selectedTip > 0 ? icon('checkCircle', 16, '', 'var(--go-text)') : icon('chevronRight', 16)}
          </div>
        </button>

        <!-- Coupon Pill -->
        <button type="button" id="favor-open-coupon-btn" style="display:flex; align-items:center; justify-content:space-between; padding:14px 16px; background:var(--color-bg-card); border:1.5px solid ${appliedCoupon ? 'var(--color-primary)' : 'var(--color-border-light)'}; border-radius:18px; cursor:pointer; transition:all 0.2s; outline:none; text-align:left; width:100%; box-sizing:border-box; box-shadow: var(--shadow-sm);">
          <div style="display:flex; align-items:center; gap:12px; min-width:0;">
            <div style="width:36px; height:36px; background:${appliedCoupon ? 'var(--go-ink)' : 'var(--color-surface-hover)'}; color:${appliedCoupon ? 'white' : 'var(--color-text-secondary)'}; border-radius:12px; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
              ${icon('tag', 18)}
            </div>
            <div style="min-width:0;">
              <div style="font-size:12px; font-weight:900; color:var(--color-text-primary); text-transform:uppercase; letter-spacing:0.5px;">Cupón de Descuento</div>
              <div style="font-size:11px; color:var(--color-text-secondary); opacity:0.85; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-top:2px;">
                ${appliedCoupon ? `${appliedCoupon.code} - ${appliedCoupon.type === 'free_delivery' ? 'Envío Gratis' : (appliedCoupon.discountType === 'percentage' ? `${appliedCoupon.value}% OFF` : `$${appliedCoupon.value} OFF`)}` : 'Ingresar cupón'}
              </div>
            </div>
          </div>
          <div style="font-size:12px; color:var(--color-text-secondary); display:flex; align-items:center; flex-shrink:0; margin-left:4px;">
            ${appliedCoupon ? icon('checkCircle', 16, '', 'var(--go-text)') : icon('chevronRight', 16)}
          </div>
        </button>
      </div>
    `;

    container.querySelector('#favor-open-tip-btn').onclick = () => {
      openTipModalLocal();
    };

    container.querySelector('#favor-open-coupon-btn').onclick = () => {
      openCouponModalLocal();
    };
  }

  function openTipModalLocal() {
    const presetTips = [300, 500, 700];
    const isCustom = selectedTip > 0 && !presetTips.includes(selectedTip);

    const modalContent = document.createElement('div');
    modalContent.style.cssText = 'padding: 24px 20px 40px; background: var(--color-bg); border-top-left-radius: 28px; border-top-right-radius: 28px; display: flex; flex-direction: column; gap: 20px;';

    modalContent.innerHTML = `
      <div style="width: 40px; height: 5px; background: var(--color-border-light); border-radius: 10px; margin: 0 auto 8px; flex-shrink: 0;"></div>
      
      <div style="text-align: center;">
        <div style="width: 56px; height: 56px; background: var(--go-ink); color: white; border-radius: 18px; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; box-shadow: none;">
          ${icon('dollarSign', 28)}
        </div>
        <h2 style="font-family: var(--font-display); font-size: 1.4rem; font-weight: 900; color: var(--color-text-primary); margin: 0 0 4px 0;">
          Propina al Repartidor
        </h2>
        <p style="font-size: 13px; color: var(--color-text-secondary); margin: 0; line-height: 1.5; padding: 0 10px;">
          El 100% de la propina va directamente al repartidor para apoyar su valioso servicio y dedicación.
        </p>
      </div>

      <div style="display:flex; flex-direction:column; gap:16px; margin-top:8px;">
        <div style="display:flex; gap:10px; flex-wrap:wrap; width:100%;">
          ${presetTips.map(amount => {
            const isActive = selectedTip === amount;
            return `
              <button type="button" class="tip-modal-preset-btn ${isActive ? 'active' : ''}" 
                      data-amount="${amount}"
                      style="flex:1; min-width:80px; height:46px; border-radius:12px; border:2px solid ${isActive ? 'var(--color-primary)' : 'var(--color-border-light)'}; background:${isActive ? 'rgba(var(--color-primary-rgb),0.1)' : 'var(--color-bg-secondary)'}; color:${isActive ? 'var(--color-primary)' : 'var(--color-text-primary)'}; font-size:14px; font-weight:800; cursor:pointer; transition:all 0.2s;">
                + ${formatPrice(amount)}
              </button>
            `;
          }).join('')}
        </div>

        <div style="display:flex; flex-direction:column; gap:8px;">
          <label style="font-size:11px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.05em;">Otro Monto (Opcional)</label>
          <div style="position:relative; display:flex; align-items:center;">
            <span style="position:absolute; left:16px; font-size:16px; font-weight:800; color:var(--color-text-secondary);">$</span>
            <input type="number" id="tip-modal-custom-input" 
                   min="1" 
                   placeholder="Ingresa otro valor" 
                   value="${isCustom ? selectedTip : ''}"
                   style="width:100%; height:50px; border-radius:14px; background:var(--color-bg-secondary); border:2px solid var(--color-border-light); padding:0 16px 0 32px; font-size:15px; font-weight:800; color:var(--color-text-primary); outline:none; transition:all 0.2s;" />
          </div>
        </div>
      </div>

      <div style="display: flex; gap: 12px; margin-top: 12px;">
        ${selectedTip > 0 ? `
          <button type="button" id="tip-modal-clear-btn" class="btn btn-ghost" style="height: 52px; flex: 1; border-radius: 14px; font-weight: 800; color: var(--color-danger); background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.15); display: flex; align-items: center; justify-content: center; gap: 8px; padding:0;">
            ${icon('trash', 16)} Eliminar
          </button>
        ` : ''}
        <button type="button" id="tip-modal-confirm-btn" class="btn btn-primary" style="height: 52px; flex: 2; border-radius: 14px; font-weight: 900; font-size: 14px; display: flex; align-items: center; justify-content: center; gap: 8px;">
          ${icon('check', 16)} APLICAR PROPINA
        </button>
      </div>
    `;

    const tipModal = showModal({
      title: '',
      hideHeader: true,
      height: 'auto',
      content: modalContent
    });

    const customInput = modalContent.querySelector('#tip-modal-custom-input');

    modalContent.querySelectorAll('.tip-modal-preset-btn').forEach(btn => {
      btn.onclick = () => {
        modalContent.querySelectorAll('.tip-modal-preset-btn').forEach(b => {
          b.classList.remove('active');
          b.style.borderColor = 'var(--color-border-light)';
          b.style.backgroundColor = 'var(--color-bg-secondary)';
          b.style.color = 'var(--color-text-primary)';
        });
        btn.classList.add('active');
        btn.style.borderColor = 'var(--color-primary)';
        btn.style.backgroundColor = 'rgba(var(--color-primary-rgb),0.1)';
        btn.style.color = 'var(--color-primary)';
        
        if (customInput) customInput.value = '';
      };
    });

    if (customInput) {
      customInput.oninput = () => {
        modalContent.querySelectorAll('.tip-modal-preset-btn').forEach(b => {
          b.classList.remove('active');
          b.style.borderColor = 'var(--color-border-light)';
          b.style.backgroundColor = 'var(--color-bg-secondary)';
          b.style.color = 'var(--color-text-primary)';
        });
      };
    }

    const confirmBtn = modalContent.querySelector('#tip-modal-confirm-btn');
    confirmBtn.onclick = () => {
      let finalAmount = 0;
      const activePreset = modalContent.querySelector('.tip-modal-preset-btn.active');
      
      if (activePreset) {
        finalAmount = parseInt(activePreset.dataset.amount, 10);
      } else if (customInput) {
        const valStr = customInput.value.trim();
        if (valStr) {
          finalAmount = parseInt(valStr, 10);
          if (isNaN(finalAmount) || finalAmount <= 0) {
            showToast('Por favor ingresá un monto de propina válido.', 'warning');
            return;
          }
        }
      }

      selectedTip = finalAmount;
      if (finalAmount > 0) {
        showToast(`Propina de ${formatPrice(finalAmount)} agregada.`, 'success');
      } else {
        showToast('Propina eliminada.', 'info');
      }
      tipModal.close();
      render();
      onUpdate(selectedTip, appliedCoupon);
    };

    const clearBtn = modalContent.querySelector('#tip-modal-clear-btn');
    if (clearBtn) {
      clearBtn.onclick = () => {
        selectedTip = 0;
        showToast('Propina eliminada.', 'info');
        tipModal.close();
        render();
        onUpdate(selectedTip, appliedCoupon);
      };
    }
  }

  function openCouponModalLocal() {
    const modalContent = document.createElement('div');
    modalContent.style.cssText = 'padding: 24px 20px 40px; background: var(--color-bg); border-top-left-radius: 28px; border-top-right-radius: 28px; display: flex; flex-direction: column; gap: 20px;';

    modalContent.innerHTML = `
      <div style="width: 40px; height: 5px; background: var(--color-border-light); border-radius: 10px; margin: 0 auto 8px; flex-shrink: 0;"></div>
      
      <div style="text-align: center;">
        <div style="width: 56px; height: 56px; background: var(--go-ink); color: white; border-radius: 18px; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; box-shadow: none;">
          ${icon('tag', 26)}
        </div>
        <h2 style="font-family: var(--font-display); font-size: 1.4rem; font-weight: 900; color: var(--color-text-primary); margin: 0 0 4px 0;">
          Ingresar Cupón
        </h2>
        <p style="font-size: 13px; color: var(--color-text-secondary); margin: 0; line-height: 1.5; padding: 0 10px;">
          Ingresá un código promocional para obtener envíos gratis o descuentos.
        </p>
      </div>

      ${appliedCoupon ? `
        <div style="background: var(--go-card); border: 1.5px solid var(--go-line); border-radius: 16px; padding: 14px; display: flex; align-items: center; justify-content: space-between;">
          <div>
            <div style="font-size: 11px; font-weight: 900; color: var(--go-green); text-transform: uppercase; letter-spacing: 0.5px;">CUPÓN ACTIVO</div>
            <div style="font-size: 14px; font-weight: 800; color: var(--color-text-primary); margin-top: 2px;">
              ${appliedCoupon.code} <span style="font-size: 12px; font-weight: 600; color: var(--color-text-secondary); opacity: 0.85;">(${appliedCoupon.type === 'free_delivery' ? 'Envío Gratis' : `${appliedCoupon.value}% OFF`})</span>
            </div>
          </div>
          <div style="width: 24px; height: 24px; color: var(--go-green); display: flex; align-items: center; justify-content: center;">
            ${icon('checkCircle', 18)}
          </div>
        </div>
      ` : ''}

      <div style="display:flex; flex-direction:column; gap:8px;">
        <label style="font-size:11px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.05em;">Código del Cupón</label>
        <div style="position:relative; display:flex; align-items:center; width:100%;">
          <input type="text" id="coupon-modal-input" 
                 placeholder="Ej. GODEL-XYZ" 
                 value="${appliedCoupon ? appliedCoupon.code : ''}"
                 style="width:100%; height:50px; border-radius:14px; background:var(--color-bg-secondary); border:2px solid var(--color-border-light); padding:0 16px; font-size:15px; font-weight:800; color:var(--color-text-primary); outline:none; transition:all 0.2s; text-transform: uppercase;" />
        </div>
        <div id="coupon-modal-error" style="display:none; color:var(--color-danger); font-size:12px; font-weight:700; padding-left:4px; margin-top: 4px;"></div>
      </div>

      <div style="display: flex; gap: 12px; margin-top: 12px;">
        ${appliedCoupon ? `
          <button type="button" id="coupon-modal-clear-btn" class="btn btn-ghost" style="height: 52px; flex: 1; border-radius: 14px; font-weight: 800; color: var(--color-danger); background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.15); display: flex; align-items: center; justify-content: center; gap: 8px; padding: 0;">
            ${icon('trash', 16)} Quitar
          </button>
        ` : ''}
        <button type="button" id="coupon-modal-confirm-btn" class="btn btn-primary" style="height: 52px; flex: 2; border-radius: 14px; font-weight: 900; font-size: 14px; display: flex; align-items: center; justify-content: center; gap: 8px; background: var(--go-ink); border: none; box-shadow: none;">
          ${icon('check', 16)} APLICAR CUPÓN
        </button>
      </div>
    `;

    const couponModal = showModal({
      title: '',
      hideHeader: true,
      height: 'auto',
      content: modalContent
    });

    const input = modalContent.querySelector('#coupon-modal-input');
    const errorMsg = modalContent.querySelector('#coupon-modal-error');
    const confirmBtn = modalContent.querySelector('#coupon-modal-confirm-btn');
    const clearBtn = modalContent.querySelector('#coupon-modal-clear-btn');

    if (input) {
      input.oninput = () => {
        if (errorMsg) errorMsg.style.display = 'none';
        input.value = input.value.toUpperCase();
      };
    }

    confirmBtn.onclick = async () => {
      const valStr = input.value.trim().toUpperCase();
      if (!valStr) {
        errorMsg.textContent = 'Por favor ingresá un código de cupón.';
        errorMsg.style.display = 'block';
        return;
      }

      confirmBtn.disabled = true;
      confirmBtn.innerHTML = `${icon('loader', 16, 'animate-spin')} VALIDANDO...`;
      if (clearBtn) clearBtn.disabled = true;
      if (input) input.disabled = true;

      try {
        const couponRef = doc(db, 'coupons', valStr);
        const couponSnap = await getDoc(couponRef);

        if (!couponSnap.exists()) {
          throw new Error('El cupón ingresado no existe.');
        }

        const cData = couponSnap.data();

        if (cData.active !== true) {
          throw new Error('El cupón ingresado no está activo.');
        }

        if (typeof cData.remaining === 'number' && cData.remaining <= 0) {
          throw new Error('Este cupón ya no tiene usos disponibles.');
        }

        if (cData.expirationDate) {
          const expDate = new Date(cData.expirationDate + 'T23:59:59-03:00');
          if (Date.now() > expDate.getTime()) {
            throw new Error('Este cupón ha expirado.');
          }
        }

        if (cData.ownerId && cData.ownerId !== 'admin') {
          throw new Error('Este cupón es de un comercio específico y no aplica a envíos.');
        }



        appliedCoupon = {
          code: valStr,
          ...cData
        };

        showToast('Cupón aplicado con éxito', 'success');
        couponModal.close();
        render();
        onUpdate(selectedTip, appliedCoupon);
      } catch (err) {
        errorMsg.textContent = err.message;
        errorMsg.style.display = 'block';
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = `${icon('check', 16)} APLICAR CUPÓN`;
        if (clearBtn) clearBtn.disabled = false;
        if (input) input.disabled = false;
      }
    };

    if (clearBtn) {
      clearBtn.onclick = () => {
        appliedCoupon = null;
        showToast('Cupón removido', 'info');
        couponModal.close();
        render();
        onUpdate(selectedTip, appliedCoupon);
      };
    }
  }

  render();
}

// Mandados is a page now (#/mandados). Kept for callers that open it with a preselected form.
export function openMandadosWizard(initialServiceType = null) {
  window.location.hash = initialServiceType ? `#/mandados?tipo=${encodeURIComponent(initialServiceType)}` : '#/mandados';
}

// Promo banner of the day (cached, then refreshed). Tapping it opens the Mandado form
// prefilled with that store.
async function loadMandadosBanner(slideToForm) {
    try {
      const renderBannerHTML = (banner, limitExceeded) => {
        const displayTitle = banner.title && banner.title.trim() !== '' ? banner.title : banner.name;
        let displaySubtitle = banner.subtitle && banner.subtitle.trim() !== '' ? banner.subtitle : 'Pedir ahora';
        if (!banner.subtitle || banner.subtitle.trim() === '') {
          if (banner.hasDiscount) {
            displaySubtitle = limitExceeded 
              ? 'Cupos de descuento agotados por hoy' 
              : `¡Envío Bonificado: -${formatPrice(banner.discountAmount)}!`;
          }
        }

        return `
          ${banner.hasPremiumGlow ? `
          <style>
            @keyframes premiumGlow {
              0% {
                box-shadow: 0 0 6px rgba(252, 211, 77, 0.5), 0 12px 32px rgba(0,0,0,0.15);
                border-color: rgba(252, 211, 77, 0.6) !important;
              }
              50% {
                box-shadow: 0 0 22px rgba(252, 211, 77, 0.95), 0 12px 32px rgba(0,0,0,0.15);
                border-color: rgba(252, 211, 77, 1) !important;
              }
              100% {
                box-shadow: 0 0 6px rgba(252, 211, 77, 0.5), 0 12px 32px rgba(0,0,0,0.15);
                border-color: rgba(252, 211, 77, 0.6) !important;
              }
            }
            .glowing-premium-card {
              animation: premiumGlow 3s infinite ease-in-out !important;
              border-width: 2px !important;
            }
          </style>
          ` : ''}
          <div id="wizard-banner-card" class="wizard-banner-card-premium ${banner.hasPremiumGlow ? 'glowing-premium-card' : ''}" style="border-radius:22px; overflow:hidden; border:1.5px solid rgba(255,255,255,0.18); position:relative; box-shadow: 0 12px 32px rgba(0,0,0,0.15); cursor:pointer; width:100%; aspect-ratio:auto; flex-shrink:1; height:100%; transition:transform 0.2s;">
            <img src="${banner.imageUrl}" style="width:100%; height:100%; object-fit:cover; display:block;" />
            
            <!-- Floating Promo Badge -->
            <div style="position:absolute; top:12px; left:12px; background:rgba(225,29,72,0.95); backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px); color:white; font-size:9.5px; font-weight:950; padding:4px 10px; border-radius:8px; text-transform:uppercase; letter-spacing:0.08em; box-shadow:0 4px 12px rgba(225,29,72,0.35); display:flex; align-items:center; gap:4px; z-index:5; border: 1px solid rgba(255,255,255,0.2);">
              ${icon('zap', 10)} ${banner.hasPremiumGlow ? 'DESTACADO' : 'PROMO'}
            </div>

            <!-- Glassmorphic bottom panel -->
            <div style="position:absolute; bottom:0; left:0; right:0; backdrop-filter:blur(12px); -webkit-backdrop-filter:blur(12px); background:linear-gradient(180deg, rgba(15,23,42,0.1) 0%, rgba(15,23,42,0.9) 100%); border-top:1px solid rgba(255,255,255,0.15); padding:10px 14px; display:flex; align-items:center; justify-content:space-between; gap:12px; box-sizing:border-box;">
              <div style="display:flex; align-items:center; gap:12px; min-width:0; z-index:2;">
                ${banner.logoUrl ? `
                  <div style="width:40px; height:40px; border-radius:50%; overflow:hidden; border:2px solid white; flex-shrink:0; background:white; box-shadow:0 4px 10px rgba(0,0,0,0.25);">
                    <img src="${banner.logoUrl}" style="width:100%; height:100%; object-fit:cover;" />
                  </div>
                ` : ''}
                <div style="display:flex; flex-direction:column; min-width:0;">
                  <span style="color:white; font-size:15px; font-weight:950; letter-spacing:-0.01em; text-shadow:0 1px 4px rgba(0,0,0,0.5);">${displayTitle}</span>
                  <span style="color:${limitExceeded && banner.hasDiscount ? '#ff6b6b' : '#fcd34d'}; font-size:11px; font-weight:800; margin-top:1px;">
                    ${displaySubtitle}
                  </span>
                </div>
              </div>
              <button id="wizard-banner-action-btn" style="height:34px; padding:0 14px; border-radius:8px; border:none; background:var(--color-primary); color:white; font-weight:950; font-size:11.5px; cursor:pointer; text-transform:uppercase; letter-spacing:0.04em; box-shadow:0 4px 12px rgba(var(--color-primary-rgb),0.4); z-index:10; flex-shrink:0; transition:transform 0.15s;">
                Pedir aquí
              </button>
            </div>
          </div>
        `;
      };

      const bindBannerEvents = (banner, limitExceeded) => {
        const bannerCard = document.getElementById('wizard-banner-card');
        if (bannerCard) {
          bannerCard.onclick = async (e) => {
            e.preventDefault();
            window._prefilledMerchantName = banner.merchantName;
            window._activeMandadoDiscount = banner.hasDiscount && !limitExceeded ? banner.discountAmount : 0;
            window._activeMandadoBannerId = banner.id;
            window._activeMandadoMerchantName = banner.merchantName;

            // Contador de clics: sólo con sesión (las reglas lo piden) y sin frenar el banner si falla
            if (isLoggedIn()) {
              import('firebase/firestore').then(({ doc, updateDoc, increment }) =>
                updateDoc(doc(db, 'banners_mandados', banner.id), { 'stats.clicks': increment(1) })
              ).catch(() => {});
            }

            slideToForm('mandado');
          };
        }
      };

      const bannerContainer = document.getElementById('wizard-banner-container');
      
      // Render cached banner instantly if available
      if (cachedActiveBanner && bannerContainer) {
        bannerContainer.innerHTML = renderBannerHTML(cachedActiveBanner, cachedLimitExceeded);
        bannerContainer.style.display = 'flex';
        bindBannerEvents(cachedActiveBanner, cachedLimitExceeded);
      }

      // Now fetch fresh data asynchronously in the background
      const { getDocs, query, collection, where, doc, updateDoc, increment } = await import('firebase/firestore');
      const bannerSnap = await getDocs(query(collection(db, 'banners_mandados'), where('status', '==', 'active')));
      const activeBanners = [];
      bannerSnap.forEach(d => {
        activeBanners.push({ id: d.id, ...d.data() });
      });

      const activeBanner = activeBanners.length > 0 
        ? activeBanners[Math.floor(Math.random() * activeBanners.length)] 
        : null;

      if (!activeBanner) {
        if (bannerContainer) bannerContainer.style.display = 'none';
        cachedActiveBanner = null;
        return;
      }

      const todayConversions = bannerUsesToday(activeBanner);

      const limitExceeded = activeBanner.hasDiscount && todayConversions >= activeBanner.discountLimitPerDay;
      
      // Cache it for the next time
      cachedActiveBanner = activeBanner;
      cachedLimitExceeded = limitExceeded;

      if (bannerContainer) {
        bannerContainer.innerHTML = renderBannerHTML(activeBanner, limitExceeded);
        bannerContainer.style.display = 'flex';
        bindBannerEvents(activeBanner, limitExceeded);
        
        // Contador de vistas: sólo con sesión (las reglas lo piden); si falla no es un error del banner
        if (isLoggedIn()) {
          updateDoc(doc(db, 'banners_mandados', activeBanner.id), { 'stats.impressions': increment(1) }).catch(() => {});
        }
      }
    } catch (err) {
      console.error('Error loading active banner:', err);
    }
}
