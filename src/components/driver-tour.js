// Guía del panel del repartidor: una sola vez por cadete aprobado, la primera vez que entra
// a su panel (queda en su cuenta: users.driverTourDone). Se repite desde el menú.
import { db } from '../firebase.js';
import { doc, updateDoc } from 'firebase/firestore';
import { getState } from '../state.js';
import { isDelivery } from '../auth.js';
import { startSpotlightTour, isTourRunning } from './spotlight-tour.js';

const LOCAL_KEY = (uid) => `gd-driver-tour-done-${uid}`;

const STEPS = [
  { title: 'Tu panel de repartidor', text: 'En un minuto te mostramos cómo recibir y entregar pedidos con GO!.' },
  { target: '#main-connect-hero-btn', title: 'Conectate para trabajar', text: 'Sólo te ofrecemos pedidos mientras estás conectado. Cuando terminás la jornada, te desconectás.' },
  { target: '#session-toggle-btn', title: 'Tu estado', text: 'Arriba siempre ves si estás conectado. Tocándolo te conectás o te desconectás.' },
  { title: 'Cuando entra un pedido', text: 'Suena y aparece una tarjeta con lo que le cobrás al cliente, lo que cuestan los productos y lo que ganás vos. Tenés 60 segundos para aceptarlo.' },
  { title: 'Durante el pedido', text: 'Abajo te guiamos paso a paso: ir al comercio, retirar, ir al cliente, pedirle el código de entrega y cobrar. El mapa te marca el camino.' },
  { target: '#status-today-pill', title: 'Lo de hoy', text: 'Cuánto ganaste hoy y cuántos pedidos hiciste.' },
  { target: '#driver-menu-btn', title: 'El menú', text: 'Finanzas y cuentas (lo que debés y lo que pagaste), tu historial, tu perfil, soporte y esta guía.' },
  { target: '#main-client-mode-hero-btn', title: 'Modo cliente', text: 'Si querés pedir algo para vos, pasás a la app de cliente sin perder tu cuenta de repartidor.' },
  { title: '¡Buen viaje!', text: 'Ante cualquier problema con un pedido, escribinos desde Soporte en el menú.' },
];

const onPanel = () => (location.hash || '').split('?')[0] === '#/delivery' && !!document.getElementById('session-toggle-btn');

function alreadyDone() {
  const u = getState().user;
  if (!u) return true;
  if (u.driverTourDone) return true;
  try { return localStorage.getItem(LOCAL_KEY(u.uid)) === '1'; } catch (e) { return false; }
}

async function markDone() {
  const u = getState().user;
  if (!u) return;
  u.driverTourDone = true;
  try { localStorage.setItem(LOCAL_KEY(u.uid), '1'); } catch (e) {}
  try { await updateDoc(doc(db, 'users', u.uid), { driverTourDone: true }); } catch (e) { console.warn('[Guía] No se pudo guardar:', e?.code || e); }
}

// La llama el panel del repartidor al dibujarse: sólo arranca si este cadete nunca la vio.
export function maybeStartDriverTour() {
  if (isTourRunning() || !isDelivery() || alreadyDone()) return;
  startDriverTour();
}

export function startDriverTour() {
  startSpotlightTour({
    steps: STEPS,
    canStart: onPanel,
    onEnd: markDone,
    finishLabel: 'Empezar',
    // Un pedido ofrecido tiene prioridad: la guía espera a que se acepte o se pase
    extraBlockers: '#exclusive-offer-fullscreen-overlay, #offer-accept-loader-screen',
  });
}
