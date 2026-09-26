// SOLO DESARROLLO: vista previa del panel del repartidor con pedidos simulados.
// Abrir con el servidor de desarrollo: /driver-preview.html (tamaño de celular).
// No escribe nada en la base: aceptar, rechazar y deslizar solo avanzan el caso en pantalla.
import { renderBottomDockContent, renderDriverStatusBarForPreview, calculateOptimalMultiStopSequence } from '../pages/delivery-panel.js';
import { initDriverNavigationMap, updateDriverMapLocation, renderMultiStopRoute, clearDriverRoute, clearMultiStopMarkers } from '../components/driver-navigation-map.js';
import { showExclusiveOfferOverlay, hideExclusiveOfferOverlay, stopExclusiveOfferAlert } from '../components/exclusive-offer-modal.js';
import { setState } from '../state.js';
import { showToast } from '../components/toast.js';

const USER = { uid: 'preview-driver', displayName: 'Repartidor de prueba', isOnline: true, role: 'delivery', tripStatus: 'approved' };
const DRIVER_POS = { lat: -35.0760, lng: -57.5100 };
window.lastRiderPos = DRIVER_POS;
setState({ driverTodayEarnings: 12400, driverTodayOrdersCount: 6 });
window.currentDemandHotspots = [{ name: 'Pizzería Los Sabores', count: 2, coords: [-57.5147, -35.0815] }, { name: 'Burger Norte', count: 1, coords: [-57.5060, -35.0790] }];

const now = () => Date.now();
const base = {
  comercio: () => ({
    id: 'sim_c1', orderId: '8492', status: 'ready', comercioName: 'Pizzería Los Sabores', comercioAddress: 'San Martín 1240',
    comercioCoordinates: { lat: -35.0815, lng: -57.5147 }, comercioCoords: { lat: -35.0815, lng: -57.5147 }, comercioPhone: '2221456789',
    userName: 'Gonzalo Fernández', userPhone: '2221554433', deliveryAddress: 'Calle Brenan 450', addressNotes: 'Piso 1, depto B · timbre Fernández',
    deliveryCoords: { lat: -35.0875, lng: -57.5180 }, paymentMethod: 'efectivo', totalAmount: 14500, total: 14500,
    shippingCost: 1800, deliveryCost: 1800, driverEarnings: 1800, verificationCode: '4821',
    items: [{ name: 'Pizza especial de jamón y morrones', quantity: 1, price: 9500 }, { name: 'Empanadas de carne', quantity: 4, price: 1250 }],
  }),
  mandado: () => ({
    id: 'sim_m1', orderId: '2210', status: 'accepted', isFavor: true, favorType: 'compra', comercioName: 'Farmacia del Pueblo',
    description: '1. Comercio: Farmacia del Pueblo 📦 2. Pedido: Ibuprofeno 400 ×2, alcohol en gel', userName: 'Laura P.', userPhone: '2221443322',
    deliveryAddress: 'Av. Mitre 820', deliveryCoords: { lat: -35.0835, lng: -57.5230 }, paymentMethod: 'transferencia',
    totalAmount: 9800, total: 9800, shippingCost: 2300, deliveryCost: 2300, driverEarnings: 2300, purchaseCost: 0,
  }),
  encomienda: () => ({
    id: 'sim_e1', orderId: '2217', status: 'accepted', isFavor: true, favorType: 'mandado', isEncomienda: true,
    pickupAddress: 'Belgrano 120', pickupCoords: { lat: -35.0790, lng: -57.5200 }, details: 'Caja mediana, frágil',
    userName: 'Marta G.', userPhone: '2221998877', deliveryAddress: 'Rivadavia 55', deliveryCoords: { lat: -35.0850, lng: -57.5090 },
    paymentMethod: 'transferencia', totalAmount: 2600, total: 2600, shippingCost: 2600, deliveryCost: 2600, driverEarnings: 2600,
  }),
  viaje: () => ({
    id: 'sim_v1', orderId: '3301', status: 'accepted', isTrip: true, tripType: 'moto', userName: 'Lucía M.', userPhone: '2221776655',
    originAddress: 'Belgrano 355', pickupCoords: { lat: -35.0800, lng: -57.5170 }, destinationAddress: 'Terminal de ómnibus',
    deliveryAddress: 'Terminal de ómnibus', deliveryCoords: { lat: -35.0900, lng: -57.5250 }, paymentMethod: 'efectivo',
    totalAmount: 3200, total: 3200, shippingCost: 3200, deliveryCost: 3200, driverEarnings: 3200,
  }),
  gocash: () => ({
    id: 'sim_g1', orderId: '4102', status: 'accepted', isFavor: true, favorType: 'gocash', amount: 20000, userName: 'Pablo R.',
    userPhone: '2221665544', deliveryAddress: 'Moreno 1020', deliveryCoords: { lat: -35.0780, lng: -57.5120 }, paymentMethod: 'transferencia',
    totalAmount: 20900, total: 20900, shippingCost: 900, deliveryCost: 900, driverEarnings: 900,
  }),
  burger: (n, name, addr, lat, lng, pay) => ({
    id: `sim_b${n}`, orderId: `77${n}0`, status: 'ready', comercioName: 'Burger Norte', comercioAddress: 'Calle 12 n° 100',
    comercioCoordinates: { lat: -35.0790, lng: -57.5060 }, comercioCoords: { lat: -35.0790, lng: -57.5060 }, userName: name, userPhone: '222155000' + n, deliveryAddress: addr,
    deliveryCoords: { lat, lng }, paymentMethod: pay, totalAmount: 11200, total: 11200, shippingCost: 1700, deliveryCost: 1700, driverEarnings: 1700,
    items: [{ name: 'Hamburguesa doble', quantity: 2, price: 4800 }, { name: 'Papas grandes', quantity: 1, price: 1600 }],
  }),
};

const offer = (order, extra = {}) => ({ id: order.id, isBundle: false, isFavor: !!order.isFavor, isTrip: !!order.isTrip, order: { ...order, queueOfferedAt: now() - 8000, queueTargetDriverId: USER.uid }, total: order.totalAmount, subtotal: order.purchaseCost || 0, createdAt: { toMillis: now, toDate: () => new Date() }, ...extra });

const CASES = {
  'Esperando pedidos': () => ({ orders: [] }),
  'Oferta · comercio': () => ({ orders: [], offer: offer(base.comercio()) }),
  'Oferta · mandado': () => ({ orders: [], offer: offer(base.mandado()) }),
  'Oferta · encomienda': () => ({ orders: [], offer: offer(base.encomienda()) }),
  'Oferta · GoViaje': () => ({ orders: [], offer: offer(base.viaje()) }),
  'Oferta · Go Cash': () => ({ orders: [], offer: offer(base.gocash()) }),
  'Oferta · lote de 2': () => {
    const a = base.burger(1, 'Martín S.', 'Calle 12 n° 340', -35.0745, -57.5040, 'efectivo');
    const b = base.burger(2, 'Ana G.', 'Moreno 88', -35.0730, -57.5075, 'transferencia');
    return { orders: [], offer: { id: 'dynamic-commerce-burger-0', isBundle: true, isDynamicGroup: true, comercioName: 'Burger Norte', orders: [{ ...a, queueOfferedAt: now() - 8000, queueTargetDriverId: USER.uid }, b], total: 22400, subtotal: 0, createdAt: { toMillis: now, toDate: () => new Date() } } };
  },
  '1 pedido · retirar': () => ({ orders: [base.comercio()] }),
  '1 pedido · entregar': () => ({ orders: [{ ...base.comercio(), status: 'delivering', pickedUpAt: now() }] }),
  '1 mandado · comprar': () => ({ orders: [base.mandado()] }),
  '1 encomienda · retirar': () => ({ orders: [base.encomienda()] }),
  'GoViaje · buscar pasajero': () => ({ orders: [base.viaje()] }),
  'GoViaje · a bordo': () => ({ orders: [{ ...base.viaje(), status: 'delivering', pickedUpAt: now() }] }),
  'Go Cash · entregar': () => ({ orders: [{ ...base.gocash(), status: 'delivering', pickedUpAt: now() }] }),
  '2 pedidos (lote)': () => ({ orders: [
    { ...base.burger(1, 'Martín S.', 'Calle 12 n° 340', -35.0745, -57.5040, 'efectivo'), status: 'delivering', pickedUpAt: now() },
    { ...base.burger(2, 'Ana G.', 'Moreno 88', -35.0730, -57.5075, 'transferencia'), status: 'delivering', pickedUpAt: now() },
  ] }),
  '3 pedidos': () => ({ orders: [base.comercio(), base.mandado(), base.encomienda()] }),
  '2 retiros cerca (orden inteligente)': () => {
    const pizza = base.comercio();
    const burger = { ...base.burger(3, 'Sofía R.', 'Av. del Sur 1500', -35.0985, -57.5230, 'efectivo'),
      comercioName: 'Burger Centro', comercioCoords: { lat: -35.0822, lng: -57.5120 }, comercioCoordinates: { lat: -35.0822, lng: -57.5120 } };
    return { orders: [{ ...pizza, deliveryAddress: 'Calle 25 n° 900', deliveryCoords: { lat: -35.0960, lng: -57.5260 } }, burger] };
  },
  'Panel escondido': () => ({ orders: [base.comercio()], hidden: true }),
};

let orders = [];
const statusBar = document.getElementById('driver-top-status-bar');
const dock = document.getElementById('driver-footer-dock-container');

function drawRoute() {
  if (!orders.length) { clearDriverRoute(); clearMultiStopMarkers(); return; }
  const stops = calculateOptimalMultiStopSequence(DRIVER_POS, orders);
  renderMultiStopRoute(stops, DRIVER_POS).catch(() => {});
}

function render() {
  statusBar.innerHTML = renderDriverStatusBarForPreview(USER, orders);
  dock.innerHTML = renderBottomDockContent(USER, orders);
  bindDock();
}

function bindDock() {
  const rerender = () => render();
  const expand = document.getElementById('dock-expand-toggle-btn');
  if (expand) expand.onclick = (e) => { e.stopPropagation(); window.driverDockExpanded = !window.driverDockExpanded; rerender(); };
  const hide = document.getElementById('dock-hide-card-btn');
  if (hide) hide.onclick = (e) => { e.stopPropagation(); window.driverDockHidden = true; rerender(); };
  const unhide = document.getElementById('dock-unhide-btn');
  if (unhide) unhide.onclick = (e) => { e.stopPropagation(); window.driverDockHidden = false; rerender(); };
  const mini = document.querySelector('#driver-bottom-sheet-card.dock-minimized');
  if (mini) mini.onclick = () => { window.driverDockHidden = false; rerender(); };
  document.querySelectorAll('.dock-order-tab-btn').forEach((b) => { b.onclick = (e) => { e.stopPropagation(); window.driverSelectedOrderIndex = Number(b.dataset.index) || 0; rerender(); }; });
  ['driver-quick-auto-accept-btn', 'driver-quick-support-btn', 'driver-quick-help-btn', 'driver-quick-sos-btn'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.onclick = () => showToast('En la app abre su pantalla (vista previa)', 'info');
  });
  document.querySelectorAll('.driver-dock-chat-btn, .open-order-breakdown-btn, .edit-mandado-purchase-btn').forEach((el) => {
    el.onclick = (e) => { e.stopPropagation(); showToast('En la app abre su pantalla (vista previa)', 'info'); };
  });
  document.querySelectorAll('.driver-swipe-slider').forEach(bindSlider);
}

// Deslizador: mismo gesto que en la app (se confirma al pasar el 80 %), pero solo avanza el caso
function bindSlider(slider) {
  const handle = slider.querySelector('.swipe-slider-handle');
  const fill = slider.querySelector('.swipe-slider-fill');
  const label = slider.querySelector('.swipe-slider-label');
  let pid = null, startX = 0, max = 0, delta = 0;
  slider.addEventListener('pointerdown', (e) => {
    pid = e.pointerId; try { slider.setPointerCapture(pid); } catch (err) {}
    startX = e.clientX; delta = 0; max = Math.max(10, slider.clientWidth - handle.clientWidth - 6);
    handle.style.transition = 'none'; fill.style.transition = 'none'; e.preventDefault();
  });
  slider.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pid) return;
    delta = Math.min(max, Math.max(0, e.clientX - startX));
    handle.style.left = `${delta + 3}px`;
    fill.style.width = `${((delta + 24) / slider.clientWidth) * 100}%`;
    if (label) label.style.opacity = Math.max(0, 1 - delta / (max * 0.6));
  });
  const up = (e) => {
    if (e.pointerId !== pid) return;
    pid = null;
    if (delta < max * 0.8) {
      handle.style.transition = fill.style.transition = 'all .25s ease';
      handle.style.left = '3px'; fill.style.width = '0%'; if (label) label.style.opacity = '1';
      return;
    }
    handle.style.left = `${max + 3}px`; fill.style.width = '100%';
    if (label) { label.textContent = 'Confirmado'; label.style.opacity = '1'; }
    setTimeout(() => {
      const id = slider.dataset.id;
      if (slider.dataset.action === 'pickup') {
        orders = orders.map((o) => (o.id === id ? { ...o, status: 'delivering', pickedUpAt: now() } : o));
        showToast('Retirado (vista previa)', 'success');
      } else {
        orders = orders.filter((o) => o.id !== id);
        showToast('Entregado (vista previa)', 'success');
      }
      window.driverSelectedOrderIndex = undefined;
      render(); drawRoute();
    }, 350);
  };
  slider.addEventListener('pointerup', up);
  slider.addEventListener('pointercancel', up);
}

function showCase(name) {
  hideExclusiveOfferOverlay(); stopExclusiveOfferAlert();
  const c = CASES[name]();
  orders = c.orders;
  window.driverDockExpanded = false;
  window.driverDockHidden = !!c.hidden;
  window.driverSelectedOrderIndex = undefined;
  render(); drawRoute();
  if (c.offer) {
    showExclusiveOfferOverlay(c.offer, USER);
    stopExclusiveOfferAlert();
    const acc = document.getElementById('fullscreen-accept-offer-btn');
    const rej = document.getElementById('fullscreen-reject-offer-btn');
    const ord = c.offer.isBundle ? c.offer.orders : [c.offer.order];
    if (acc) acc.onclick = () => { hideExclusiveOfferOverlay(); orders = ord.map((o) => ({ ...o })); render(); drawRoute(); showToast('Aceptado (vista previa)', 'success'); };
    if (rej) rej.onclick = () => { hideExclusiveOfferOverlay(); showToast('Rechazado (vista previa)', 'info'); };
  }
}

const select = document.getElementById('preview-case-select');
Object.keys(CASES).forEach((k) => { const o = document.createElement('option'); o.value = k; o.textContent = k; select.appendChild(o); });
select.onchange = () => showCase(select.value);

initDriverNavigationMap(document.getElementById('driver-fullscreen-map')).then(() => {
  setTimeout(() => { try { updateDriverMapLocation(DRIVER_POS, 0); } catch (e) {} drawRoute(); }, 800);
}).catch((e) => console.warn('Mapa de la vista previa:', e));
const initialCase = new URLSearchParams(location.search).get('caso') || 'Esperando pedidos';
select.value = initialCase;
showCase(initialCase);
