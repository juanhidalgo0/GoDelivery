// Guía de la app para clientes: una sola vez por persona, sobre la pantalla de inicio.
// Con sesión queda marcada en la cuenta (users.clientTourDone), así no vuelve a salir en
// otro teléfono; sin sesión, en este navegador. Se repite desde el botón de ayuda del encabezado.
import { db } from '../firebase.js';
import { doc, updateDoc } from 'firebase/firestore';
import { getState } from '../state.js';
import { startSpotlightTour, isTourRunning } from './spotlight-tour.js';

const GUEST_KEY = 'gd-client-tour-done';
const userKey = (uid) => `gd-client-tour-done-${uid}`;

// El inicio hace scroll dentro de #page-home; al bajar hasta los comercios, el encabezado se va de vista
const toTop = () => document.getElementById('page-home')?.scrollTo({ top: 0, behavior: 'smooth' });

const STEPS = [
  { title: 'Bienvenido a GO!', text: 'Te mostramos en un minuto cómo pedir. Podés saltar la guía cuando quieras.' },
  { target: '#header-location-selector', before: toTop, title: '¿Dónde te lo llevamos?', text: 'Elegí tu dirección. Con ella te mostramos qué te llega y cuánto sale el envío.' },
  { target: '#header-search-container', title: 'Buscá lo que quieras', text: 'Escribí un comercio o un producto: una pizza, pañales, una birome.' },
  { target: '.go-services', title: 'Mandados, viajes y más', text: 'Mandados: te compramos o llevamos lo que sea. Viajes: te busca una moto. Market y Ofertas, a un toque.' },
  { target: '#categories-row-small, .categories-slider-wrapper', title: 'Rubros', text: 'Entrá por rubro para ver todos los comercios de comida, súper, farmacia y más.' },
  { target: '.go-store-card', title: 'Los comercios', text: 'Tocá uno, elegí tus productos y sumalos al carrito.' },
  { target: '.bottom-nav .nav-item[href="#/cart"]', before: toTop, title: 'Tu carrito', text: 'Revisás el pedido, elegís cómo pagar (efectivo o transferencia) y lo confirmás.' },
  { target: '.bottom-nav .nav-item[href="#/mis-chats"]', title: 'Chats', text: 'Hablás con el comercio o con tu cadete mientras llega tu pedido.' },
  { target: '#header-info-btn', before: toTop, title: 'Esta guía', text: 'Si te olvidás de algo, la volvés a ver tocando acá.' },
  { title: '¡A pedir!', text: 'Cuando confirmes, seguís tu pedido en vivo en el mapa y te avisamos en cada paso.' },
];

const onHome = () => {
  const h = location.hash || '#/';
  return (h === '#/' || h === '#' || h.startsWith('#/?')) &&
    !document.body.classList.contains('is-delivery-mode') &&
    !document.querySelector('#app-overlay.active');
};

function alreadyDone() {
  const u = getState().user;
  try {
    if (u) {
      if (u.clientTourDone || localStorage.getItem(userKey(u.uid)) === '1') return true;
      // La vio sin sesión en este teléfono: se la da por vista también en la cuenta
      if (localStorage.getItem(GUEST_KEY) === '1') { markDone(); return true; }
      return false;
    }
    return localStorage.getItem(GUEST_KEY) === '1';
  } catch (e) {
    return !!u?.clientTourDone;
  }
}

async function markDone() {
  const u = getState().user;
  try { localStorage.setItem(GUEST_KEY, '1'); } catch (e) {}
  if (!u) return;
  u.clientTourDone = true;
  try { localStorage.setItem(userKey(u.uid), '1'); } catch (e) {}
  try { await updateDoc(doc(db, 'users', u.uid), { clientTourDone: true }); } catch (e) { console.warn('[Guía] No se pudo guardar:', e?.code || e); }
}

// La llama el inicio cada vez que se dibuja: sólo arranca si esta persona nunca la vio.
export function maybeStartClientTour() {
  if (isTourRunning() || alreadyDone()) return;
  startClientTour();
}

export function startClientTour() {
  startSpotlightTour({ steps: STEPS, canStart: onHome, onEnd: markDone, finishLabel: 'A pedir' });
}
