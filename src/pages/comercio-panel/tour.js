// Guía del panel del comercio: sale sola una vez, la primera vez que un usuario con rol
// comercio entra a su panel (queda marcado en su cuenta: users.commercePanelTourDone).
// Se repite desde Local → Ver la guía del panel.
import { db } from '../../firebase.js';
import { doc, updateDoc } from 'firebase/firestore';
import { getState } from '../../state.js';
import { isAdmin, isComercio } from '../../auth.js';
import { startSpotlightTour } from '../../components/spotlight-tour.js';

const LOCAL_KEY = (uid) => `gd-comercio-tour-${uid}`;

// En PC las pestañas van en un menú a la izquierda (commerce-panel.css)
const NAV_WHERE = typeof matchMedia === 'function' && matchMedia('(min-width: 1024px)').matches ? 'a la izquierda' : 'abajo';

const STEPS = [
  { title: 'Tu panel de GO!', text: `En un minuto te mostramos cómo se usa. Todo está ${NAV_WHERE}, en 5 pestañas, y arriba ves si tu local está abierto.` },
  { target: '#cp-status', title: 'Abierto o pausado', text: 'Si se te llena la cocina o tenés que cerrar un rato, tocá acá para pausar. Mientras está pausado no entran pedidos nuevos.' },
  { target: '.cp-tab[data-tab="orders"]', title: 'Pedidos', text: 'Acá entran los pedidos. Cuando llega uno suena una alarma hasta que lo aceptás. El número te dice cuántos esperan.' },
  { target: '.cp-seg', title: 'Nuevos, Preparando, Listos', text: 'Aceptás un pedido eligiendo cuánto tardás (el cliente lo ve). Cuando está hecho, tocás "Está listo" y avisamos al cadete.' },
  { target: '.cp-tab[data-tab="menu"]', title: 'Menú', text: 'Tus productos y precios. Si algo se agota, apagá su interruptor y deja de ofrecerse al instante.' },
  { target: '.cp-tab[data-tab="promos"]', title: 'Promos', text: 'Descuentos, 2x1, cupones y el link de tu catálogo para compartir por WhatsApp.' },
  { target: '.cp-tab[data-tab="numbers"]', title: 'Números', text: 'Cuánto vendiste hoy, en la semana y en el mes, y lo que más sale.' },
  { target: '.cp-tab[data-tab="local"]', title: 'Local', text: 'Tus datos, fotos, horarios de cada día y el PIN para que un empleado atienda pedidos sin ver lo demás.' },
  { target: '#cp-brand', title: 'Tu logo', text: 'Tocándolo ves tu tienda como la ve el cliente, compartís tu catálogo o hablás con soporte.' },
  { title: '¡Listo!', text: 'Si te queda alguna duda, esta guía está siempre en Local → Ver la guía del panel.' },
];

export function shouldShowCommerceTour() {
  const u = getState().user;
  if (!u || u.commercePanelTourDone) return false;
  // Sólo comercios reales: el admin entra a GoMarket y a otros paneles para revisar
  if (!isComercio() || isAdmin()) return false;
  try { if (localStorage.getItem(LOCAL_KEY(u.uid)) === '1') return false; } catch (e) {}
  return true;
}

async function markDone() {
  const u = getState().user;
  if (!u) return;
  u.commercePanelTourDone = true;
  try { localStorage.setItem(LOCAL_KEY(u.uid), '1'); } catch (e) {}
  try { await updateDoc(doc(db, 'users', u.uid), { commercePanelTourDone: true }); } catch (e) { console.warn('[Guía] No se pudo guardar:', e?.code || e); }
}

export function startCommerceTour() {
  startSpotlightTour({
    steps: STEPS,
    canStart: () => !!document.getElementById('cp-shell'),
    onEnd: markDone,
  });
}
