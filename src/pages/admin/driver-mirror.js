// GoDelivery — Admin: el pedido visto como lo ve el repartidor
//
// Misma pantalla que el panel del repartidor: su mapa de navegación con el recorrido y el dock con
// los pedidos que tiene en curso, dibujados por las mismas funciones (delivery-panel.js y
// driver-navigation-map.js). La posición es la real que manda su teléfono (orders/{id}/live/driver,
// con respaldo en el pedido y en su perfil), no la del dispositivo del admin.
//
// Las acciones del dock (retirar, entregar, cargar el monto del mandado) las hace el admin en
// nombre del repartidor: escriben los mismos campos que el panel del repartidor y dejan asentado
// que fue el admin (pickedUpByAdmin / deliveredByAdmin + adminActionBy). La cuenta corriente del
// repartidor se mueve igual que si lo hubiera hecho él (la escribe el servidor al completarse).

import { db } from '../../firebase.js';
import { doc, collection, query, where, onSnapshot, updateDoc, serverTimestamp } from 'firebase/firestore';
import { getState } from '../../state.js';
import { showToast } from '../../components/toast.js';
import { showConfirm } from '../../components/modal.js';
import { icon } from '../../utils/icons.js';
import { createRiderMotion } from '../../utils/rider-motion.js';

// Same list the driver's own tracking uses (utils/background-tracking.js).
const ACTIVE_STATUSES = [
  'accepted', 'aceptado', 'confirmed', 'confirmado', 'preparing', 'preparando', 'ready', 'listo',
  'picked_up', 'retirado', 'at_door', 'en puerta', 'delivering', 'en camino'
];
// Window state the driver panel's renderers read; saved on open and restored on close.
const PANEL_GLOBALS = ['driverDockExpanded', 'driverDockHidden', 'driverSelectedOrderId', 'driverSelectedOrderIndex', 'lastRiderPos', 'currentDemandHotspots'];
const LIVE_FRESH_MS = 90 * 1000;
const ROUTE_REDRAW_M = 40;

let openInstance = null;

export function isOrderMirrorable(order) {
  return !!order?.driverId && ACTIVE_STATUSES.includes(String(order.status || '').toLowerCase());
}

function msOf(t) {
  if (!t) return 0;
  if (typeof t.toMillis === 'function') return t.toMillis();
  if (t.seconds !== undefined) return t.seconds * 1000;
  const ms = new Date(t).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

function metersBetween(a, b) {
  if (!a || !b) return Infinity;
  const R = 6371e3;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Opens the driver's own view for an order in progress. Returns false when there's no driver
 * or the order is no longer in progress (the caller then shows the customer view).
 */
export async function openDriverMirror(order) {
  if (!isOrderMirrorable(order)) return false;
  if (openInstance) openInstance.close();

  const panel = await import('../delivery-panel.js');
  const navMap = await import('../../components/driver-navigation-map.js');
  const adminEmail = getState().user?.email || 'Admin';
  const driverId = order.driverId;

  const saved = Object.fromEntries(PANEL_GLOBALS.map((k) => [k, window[k]]));
  const savedClasses = { html: document.documentElement.className, body: document.body.className };
  window.driverDockExpanded = false;
  window.driverDockHidden = false;
  window.driverSelectedOrderId = order.id;
  window.driverSelectedOrderIndex = undefined;
  window.currentDemandHotspots = [];
  window.lastRiderPos = null;

  const root = document.createElement('div');
  root.id = 'admin-driver-mirror';
  // Below the modal stack (20000000+) so chat, confirmations and the purchase sheet open on top.
  root.style.cssText = 'position:fixed; inset:0; z-index:15000000; background:#0C0F13; overflow:hidden;';
  root.innerHTML = `
    <div id="driver-fullscreen-map"></div>
    <div id="mirror-admin-bar" style="position:absolute; z-index:70; top:calc(10px + env(safe-area-inset-top, 0px)); left:10px; right:10px;
      display:flex; align-items:center; gap:8px; padding:8px; border-radius:18px; background:rgba(12,15,19,0.88); backdrop-filter:blur(10px);
      border:1px solid rgba(255,255,255,0.1); color:#fff; font-family:'Inter',system-ui,sans-serif; max-width:560px; margin:0 auto;">
      <button id="mirror-close" aria-label="Salir de la vista del repartidor" style="width:38px; height:38px; border-radius:12px; border:0; background:rgba(255,255,255,0.1); color:#fff; display:flex; align-items:center; justify-content:center; cursor:pointer; flex-shrink:0;">${icon('close', 18)}</button>
      <div style="min-width:0; flex:1;">
        <div style="font-size:10px; font-weight:800; letter-spacing:0.08em; text-transform:uppercase; color:#fbbf24; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">Admin · vista del repartidor</div>
        <div id="mirror-driver-name" style="font-size:14.5px; font-weight:800; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(order.driverName || 'Repartidor')}</div>
        <div id="mirror-live-chip" style="display:inline-block; max-width:100%; margin-top:3px; font-size:10.5px; font-weight:800; padding:2px 8px; border-radius:8px; background:rgba(255,255,255,0.1); color:#cbd5e1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">Buscando ubicación…</div>
      </div>
      <a id="mirror-call" aria-label="Llamar al repartidor" style="display:none; width:38px; height:38px; border-radius:12px; background:rgba(255,255,255,0.1); color:#fff; align-items:center; justify-content:center; flex-shrink:0; text-decoration:none;">${icon('phone', 17)}</a>
      <button id="mirror-client-view" style="height:38px; padding:0 10px; border-radius:12px; border:0; background:rgba(255,255,255,0.1); color:#fff; font-size:12px; font-weight:700; cursor:pointer; flex-shrink:0;">Vista cliente</button>
    </div>
    <div id="driver-footer-dock-container" style="position:absolute; z-index:60; left:10px; right:10px; bottom:calc(10px + env(safe-area-inset-bottom, 0px));"></div>
  `;
  document.body.appendChild(root);
  window.__driverMirrorActive = true; // the map ignores this device's own GPS (driver-navigation-map.js)

  const dock = root.querySelector('#driver-footer-dock-container');
  const liveChip = root.querySelector('#mirror-live-chip');
  let driverUser = { uid: driverId, displayName: order.driverName || 'Repartidor', role: 'delivery', isOnline: true };
  let orders = [];
  let livePos = null; // freshest of: live doc, order doc, driver's profile
  let lastRoutePos = null;
  let lastRouteSig = '';
  let mapReady = false;
  let busy = false;
  const unsubs = [];

  // ---- position ----------------------------------------------------------------------------
  const candidates = { live: null, order: null, profile: null };
  const pickFreshest = () => {
    const best = Object.values(candidates).filter((c) => c && Number.isFinite(c.lat) && Number.isFinite(c.lng))
      .sort((a, b) => b.at - a.at)[0] || null;
    // The live doc wins unless it went quiet: the order and the profile get the same point a bit
    // later, and switching to them for a moment restarted the motion (the moto jumped).
    const live = candidates.live;
    if (best && live && Number.isFinite(live.lat) && best.at - live.at < 20000) return live;
    return best;
  };
  const renderLiveChip = () => {
    const online = driverUser.isOnline === true;
    if (!livePos) {
      liveChip.textContent = online ? 'Esperando ubicación' : 'Desconectado · sin ubicación';
      liveChip.style.background = 'rgba(245,158,11,0.18)';
      liveChip.style.color = '#fbbf24';
      return;
    }
    const age = Date.now() - livePos.at;
    if (age <= LIVE_FRESH_MS) {
      liveChip.textContent = '● En vivo';
      liveChip.style.background = 'rgba(16,185,129,0.18)';
      liveChip.style.color = '#34d399';
    } else {
      const mins = Math.max(1, Math.round(age / 60000));
      liveChip.textContent = `${online ? '' : 'Desconectado · '}ubicación de hace ${mins} min`;
      liveChip.style.background = 'rgba(245,158,11,0.18)';
      liveChip.style.color = '#fbbf24';
    }
  };
  const drawRoute = (force = false) => {
    if (!mapReady || !livePos) return;
    const sig = orders.map((o) => `${o.id}:${o.status}`).join('|');
    if (!force && sig === lastRouteSig && metersBetween(lastRoutePos, livePos) < ROUTE_REDRAW_M) return;
    lastRouteSig = sig;
    lastRoutePos = { lat: livePos.lat, lng: livePos.lng };
    if (!orders.length) {
      navMap.clearDriverRoute();
      navMap.clearMultiStopMarkers();
      return;
    }
    const stops = panel.numberRoute(panel.calculateOptimalMultiStopSequence(livePos, orders), orders);
    navMap.renderMultiStopRoute(stops, livePos)
      .then(() => motion?.setRoute(navMap.getDriverRouteCoords()))
      .catch((err) => console.warn('[DriverMirror] route:', err));
  };

  // The moto and the camera follow the driver's real track smoothly (same engine as the
  // customer's map): positions arrive every ~2 s and drawing each one as it came made both jump.
  // The engine replays the track ~2 s behind, along the streets of the route.
  let motion = null;
  let motionSource = null;
  let motionHeading = 0;
  const startMotion = () => {
    if (motion) motion.stop();
    motion = createRiderMotion({
      setPosition: (p) => {
        window.lastRiderPos = { lat: p.lat, lng: p.lng };
        if (!mapReady) return;
        try { navMap.updateDriverMapLocation(p, motionHeading, { follow: true }); } catch (e) { /* map not ready */ }
      },
      setHeading: (deg) => { motionHeading = deg; },
      setRemainingRoute: () => {}, // the navigation map trims its own route line
    });
    const route = navMap.getDriverRouteCoords();
    if (route) motion.setRoute(route);
  };
  const onPosition = () => {
    const next = pickFreshest();
    if (!next) { renderLiveChip(); return; }
    livePos = next;
    renderLiveChip();
    // Reading times from different sources (driver's phone clock vs server) don't mix: a new
    // source starts the motion over at its position.
    if (!motion || motionSource !== next.source) {
      motionSource = next.source;
      startMotion();
    }
    motion.push({ lat: next.lat, lng: next.lng, t: next.t });
    drawRoute();
  };

  // ---- dock --------------------------------------------------------------------------------
  const rerender = () => {
    if (!root.isConnected) return;
    dock.innerHTML = panel.renderBottomDockContent(driverUser, orders);
    bindDock();
  };

  const writeOrder = async (id, fields, okText) => {
    busy = true;
    try {
      await updateDoc(doc(db, 'orders', id), { ...fields, adminActionBy: adminEmail, adminActionAt: serverTimestamp() });
      showToast(okText, 'success');
      return true;
    } catch (err) {
      console.error('[DriverMirror] write failed:', err);
      showToast('No se pudo guardar: ' + (err?.message || 'error'), 'error');
      return false;
    } finally {
      busy = false;
      // The orders listener usually fires while the write is in flight (and skips the redraw).
      rerender();
      drawRoute(true);
    }
  };

  const doPickup = (o, onCancel) => {
    const name = driverUser.displayName || 'el repartidor';
    const pickup = (extra = {}) => writeOrder(o.id, { status: 'delivering', pickedUpAt: serverTimestamp(), pickedUpByAdmin: true, ...extra },
      `Pedido #${o.orderId || o.id.slice(0, 6)} marcado como retirado`);
    if (panel.isShoppingFavor(o)) {
      // Same step the driver does: the errand needs what was spent before going to deliver.
      import('../delivery-panel/mandado.js').then(({ openMandadoPurchaseModal }) => openMandadoPurchaseModal({
        order: o,
        isEdit: false,
        onCancel,
        onConfirm: async (purchaseTotal, stopsData, newTotal) => {
          const ok = await pickup({ purchaseCost: purchaseTotal, purchaseItemsTotal: purchaseTotal, stopsPurchases: stopsData, total: newTotal });
          if (!ok) onCancel();
        }
      }));
      return;
    }
    showConfirm({
      title: 'Marcar como retirado',
      message: `Vas a marcar el pedido <b>#${escapeHtml(o.orderId || o.id.slice(0, 6))}</b> como retirado en nombre de <b>${escapeHtml(name)}</b>. Queda registrado que lo hizo el admin.`,
      confirmText: 'Sí, está retirado',
      onConfirm: async () => { if (!(await pickup())) onCancel(); },
      onCancel
    });
  };

  const doDeliver = (ids, onCancel) => {
    const list = orders.filter((o) => ids.includes(o.id));
    const label = list.map((o) => `#${escapeHtml(o.orderId || o.id.slice(0, 6))}`).join(', ');
    const codes = list.map((o) => o.verificationCode).filter(Boolean);
    showConfirm({
      title: 'Marcar como entregado',
      message: `Vas a marcar ${list.length > 1 ? 'los pedidos' : 'el pedido'} <b>${label}</b> como entregado en nombre de <b>${escapeHtml(driverUser.displayName || 'el repartidor')}</b>, sin pedir el código${codes.length ? ` (código del cliente: <b>${escapeHtml(codes.join(', '))}</b>)` : ''}. Queda registrado que lo hizo el admin.`,
      confirmText: 'Sí, está entregado',
      onConfirm: async () => {
        let allOk = true;
        for (const id of ids) {
          const ok = await writeOrder(id, { status: 'completed', deliveredAt: serverTimestamp(), completedAt: serverTimestamp(), deliveredByAdmin: true },
            'Pedido marcado como entregado');
          allOk = allOk && ok;
        }
        if (!allOk) onCancel();
      },
      onCancel
    });
  };

  // Same gesture as the driver's slider (confirms past 80%), then the admin action.
  const bindSlider = (slider) => {
    const handle = slider.querySelector('.swipe-slider-handle');
    const fill = slider.querySelector('.swipe-slider-fill');
    const label = slider.querySelector('.swipe-slider-label');
    if (!handle || !fill) return;
    const idleLabel = label ? label.textContent : '';
    let pid = null, startX = 0, max = 0, delta = 0;
    const reset = () => {
      if (!slider.isConnected) return;
      handle.style.transition = fill.style.transition = 'all .25s ease';
      handle.style.left = '3px';
      fill.style.width = '0%';
      if (label) { label.textContent = idleLabel; label.style.opacity = '1'; }
    };
    slider.addEventListener('pointerdown', (e) => {
      if (busy) return;
      pid = e.pointerId;
      try { slider.setPointerCapture(pid); } catch (err) { /* no capture */ }
      startX = e.clientX; delta = 0; max = Math.max(10, slider.clientWidth - handle.clientWidth - 6);
      handle.style.transition = fill.style.transition = 'none';
      e.preventDefault();
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
      if (delta < max * 0.8) { reset(); return; }
      handle.style.left = `${max + 3}px`;
      fill.style.width = '100%';
      if (label) { label.textContent = 'Confirmar…'; label.style.opacity = '1'; }
      const ids = String(slider.dataset.id || '').split(',').filter(Boolean);
      if (slider.dataset.action === 'pickup') {
        const o = orders.find((x) => x.id === ids[0]);
        if (o) doPickup(o, reset); else reset();
      } else {
        doDeliver(ids, reset);
      }
    };
    slider.addEventListener('pointerup', up);
    slider.addEventListener('pointercancel', (e) => { if (e.pointerId === pid) { pid = null; reset(); } });
  };

  function bindDock() {
    const toggle = () => { window.driverDockExpanded = !window.driverDockExpanded; rerender(); };
    const expand = root.querySelector('#dock-expand-toggle-btn');
    if (expand) expand.onclick = (e) => { e.stopPropagation(); toggle(); };
    const handle = root.querySelector('#dock-drag-handle');
    if (handle) handle.onclick = (e) => { if (!e.target.closest('button')) toggle(); };
    const hide = root.querySelector('#dock-hide-card-btn');
    if (hide) hide.onclick = (e) => { e.stopPropagation(); window.driverDockHidden = true; rerender(); };
    const unhide = root.querySelector('#dock-unhide-btn');
    if (unhide) unhide.onclick = (e) => { e.stopPropagation(); window.driverDockHidden = false; rerender(); };
    const mini = root.querySelector('#driver-bottom-sheet-card.dock-minimized');
    if (mini) mini.onclick = () => { window.driverDockHidden = false; rerender(); };
    root.querySelectorAll('.dock-order-tab-btn').forEach((b) => {
      b.onclick = (e) => {
        e.stopPropagation();
        window.driverSelectedOrderIndex = Number(b.dataset.index) || 0;
        window.driverSelectedOrderId = b.dataset.orderId || null;
        rerender();
      };
    });
    // Things only the driver's phone can do: say so instead of doing nothing.
    ['driver-quick-auto-accept-btn', 'driver-quick-support-btn', 'driver-quick-help-btn', 'driver-quick-sos-btn'].forEach((id) => {
      const el = root.querySelector(`#${id}`);
      if (el) el.onclick = (e) => { e.stopPropagation(); showToast('Eso se usa desde el teléfono del repartidor', 'info'); };
    });
    root.querySelectorAll('.driver-dock-chat-btn').forEach((btn) => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const o = orders.find((x) => x.id === btn.dataset.orderId) || orders[0];
        if (!o) return;
        const { openChat } = await import('../../components/chat.js');
        openChat({ orderId: o.id, type: 'client-delivery', otherName: btn.dataset.customerName || 'Cliente', orderNum: o.orderId || o.id.slice(0, 6), senderDisplayName: 'Admin', isAudit: true });
      };
    });
    root.querySelectorAll('.open-order-breakdown-btn').forEach((btn) => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const o = orders.find((x) => x.id === btn.dataset.orderId) || orders[0];
        if (!o) return;
        const { openOrderBreakdownModal } = await import('../delivery-panel/order-breakdown.js');
        openOrderBreakdownModal(o);
      };
    });
    root.querySelectorAll('.edit-mandado-purchase-btn').forEach((btn) => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const o = orders.find((x) => x.id === btn.dataset.orderId);
        if (!o) return;
        const { openMandadoPurchaseModal } = await import('../delivery-panel/mandado.js');
        openMandadoPurchaseModal({
          order: o,
          isEdit: true,
          onConfirm: (purchaseTotal, stopsData, newTotal) => writeOrder(o.id, {
            purchaseCost: purchaseTotal, purchaseItemsTotal: purchaseTotal, stopsPurchases: stopsData, total: newTotal, updatedAt: serverTimestamp()
          }, `Monto de compra actualizado: $${Number(purchaseTotal || 0).toLocaleString('es-AR')}`)
        });
      };
    });
    const nextStore = root.querySelector('#dock-mandado-next-store-btn');
    if (nextStore) {
      nextStore.onclick = async (e) => {
        e.stopPropagation();
        // The visited stores live on the driver's phone; here it only moves the admin's view.
        const { markStoreVisited } = await import('../../utils/mandado-places-store.js');
        markStoreVisited(nextStore.dataset.orderId, Number(nextStore.dataset.index));
        rerender();
        drawRoute(true);
      };
    }
    root.querySelectorAll('.driver-swipe-slider').forEach(bindSlider);
  }

  // ---- data --------------------------------------------------------------------------------
  unsubs.push(onSnapshot(doc(db, 'users', driverId), (snap) => {
    if (!snap.exists()) return;
    const u = snap.data();
    driverUser = { ...u, uid: driverId };
    root.querySelector('#mirror-driver-name').textContent = u.displayName || u.name || order.driverName || 'Repartidor';
    const phone = String(u.phone || u.whatsapp || '').replace(/[^\d+]/g, '');
    const call = root.querySelector('#mirror-call');
    if (phone) { call.href = `tel:${phone}`; call.style.display = 'flex'; }
    if (u.currentLocation?.lat) {
      const at = msOf(u.currentLocation.updatedAt);
      candidates.profile = { source: 'profile', lat: u.currentLocation.lat, lng: u.currentLocation.lng, at, t: at || undefined, heading: 0 };
    }
    onPosition();
  }, (err) => console.warn('[DriverMirror] driver profile:', err)));

  unsubs.push(onSnapshot(query(collection(db, 'orders'), where('driverId', '==', driverId), where('status', 'in', ACTIVE_STATUSES)), (snap) => {
    orders = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const audited = orders.find((o) => o.id === order.id);
    if (audited?.driverLocation?.lat) {
      const at = msOf(audited.driverLocation.updatedAt);
      candidates.order = { source: 'order', lat: audited.driverLocation.lat, lng: audited.driverLocation.lng, at, t: at || undefined, heading: 0 };
    }
    if (!busy) rerender();
    onPosition();
    drawRoute(true);
  }, (err) => {
    console.error('[DriverMirror] orders:', err);
    showToast('No se pudieron cargar los pedidos del repartidor', 'error');
  }));

  // Restarted after an error: a dead listener left the admin on the 30-second copy.
  let liveUnsub = () => {};
  let liveRetry = null;
  let liveAttempts = 0;
  const listenLive = () => {
    if (!root.isConnected && liveAttempts > 0) return;
    liveUnsub();
    liveUnsub = onSnapshot(doc(db, 'orders', order.id, 'live', 'driver'), (snap) => {
      liveAttempts = 0;
      if (!snap.exists()) return;
      const l = snap.data();
      const at = msOf(l.updatedAt) || Date.now();
      // fixAt: when the phone read the GPS (the motion engine spaces the track with it)
      candidates.live = { source: 'live', lat: l.lat, lng: l.lng, at, t: Number.isFinite(l.fixAt) ? l.fixAt : at, heading: l.heading || 0 };
      onPosition();
    }, (err) => {
      console.warn('[DriverMirror] live position, retrying:', err?.code || err);
      liveAttempts++;
      clearTimeout(liveRetry);
      liveRetry = setTimeout(listenLive, Math.min(2000 * liveAttempts, 30000));
    });
  };
  listenLive();
  unsubs.push(() => { clearTimeout(liveRetry); liveUnsub(); });

  // Ages the "en vivo" chip and keeps the dock's distances current between position updates.
  const ticker = setInterval(() => { renderLiveChip(); if (!busy && !window.__driverSliderDragging) rerender(); }, 15000);

  navMap.initDriverNavigationMap(root.querySelector('#driver-fullscreen-map')).then(() => {
    mapReady = true;
    const at = motion?.current() || livePos;
    if (at) {
      try { navMap.updateDriverMapLocation({ lat: at.lat, lng: at.lng }, motionHeading, { follow: true }); } catch (e) { /* map not ready */ }
    }
    drawRoute(true);
  }).catch((err) => console.warn('[DriverMirror] map:', err));

  const close = () => {
    if (!root.isConnected) return;
    unsubs.forEach((u) => { try { u(); } catch (e) { /* already closed */ } });
    if (motion) motion.stop();
    clearInterval(ticker);
    try { navMap.clearDriverRoute(); navMap.clearMultiStopMarkers(); } catch (e) { /* no map */ }
    root.remove();
    window.__driverMirrorActive = false;
    PANEL_GLOBALS.forEach((k) => { window[k] = saved[k]; });
    document.documentElement.className = savedClasses.html;
    document.body.className = savedClasses.body;
    window.removeEventListener('hashchange', onRouteChange);
    if (openInstance?.close === close) openInstance = null;
  };
  root.querySelector('#mirror-close').onclick = close;
  root.querySelector('#mirror-client-view').onclick = async () => {
    const { showDeliveryMapModal } = await import('../../components/delivery-map-modal.js');
    showDeliveryMapModal(order);
  };
  // Leaving the screen (back to the admin home, another section) closes it. Modals push history
  // entries without changing the route, so only a different route counts.
  const openRoute = location.hash.split('?')[0];
  function onRouteChange() {
    if (location.hash.split('?')[0] !== openRoute) close();
  }
  window.addEventListener('hashchange', onRouteChange);
  openInstance = { close };
  rerender();
  return true;
}
