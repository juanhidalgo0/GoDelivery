// GoDelivery — Exclusive Offer Modal Component (0ms Instant Popup)
import { getState } from '../state.js';
import { formatPrice } from '../utils/format.js';
import { AudioManager } from '../utils/audio-manager.js';
import { showToast } from '../components/toast.js';
import { db } from '../firebase.js';
import { doc, getDoc, getDocs, collection, runTransaction } from 'firebase/firestore';
import { driverTokens, orderKind, kindTag, countdownRing, RING_C, stopsList, moneyRow, infoRow, dIcon, esc, money, isCashPayment, kmBetween, kmLabel, pickupCoordsOf, dropoffCoordsOf, goCashInfo } from './driver-ui.js';
import { mandadoShoppingPlan, isPlaceholderCoords, categoryLabel } from '../utils/mandado-places.js';

export function isOrderEncomienda(order) {
  if (!order) return false;
  const isEncoFlag = Boolean(order.isEncomienda || order.isPackage || order.packageType || order.serviceType === 'encomienda' || order.type === 'encomienda');
  const itemsText = (order.itemsText || order.details || order.description || '').toLowerCase();
  const hasEncoKeywords = itemsText.includes('encomienda') || itemsText.includes('paquete') || itemsText.includes('caja') || itemsText.includes('bulto');
  return isEncoFlag || hasEncoKeywords;
}

export function cleanMandadoText(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/_(.*?)_/g, '$1')
    .replace(/#{1,6}\s?/g, '')
    .replace(/`{1,3}(.*?)`{1,3}/g, '$1')
    .replace(/•|\-/g, '·')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseMandadoDetails(text, defaultComercio = '') {
  const clean = cleanMandadoText(text);
  if (!clean) {
    return { comercio: defaultComercio || 'Kiosco / Comercio', items: 'Realizar compra o trámite' };
  }

  let comercio = defaultComercio || '';
  let items = clean;

  const comMatch = clean.match(/(?:1\.\s*Comercio|Comercio|Lugar|Local)\s*:\s*([^📦📝\n]+)/i);
  if (comMatch && comMatch[1]) {
    comercio = comMatch[1].trim();
  }

  const itemMatch = clean.match(/(?:2\.\s*Pedido|Pedido|Detalle|Instrucción|Compra)\s*:\s*(.+)/i);
  if (itemMatch && itemMatch[1]) {
    items = itemMatch[1].trim();
  }

  return { comercio: comercio || defaultComercio || 'Kiosco / Comercio', items };
}

export function getOrderDriverEarnings(o) {
  if (!o) return 0;
  if (o.driverEarnings !== undefined && o.driverEarnings !== null && !isNaN(Number(o.driverEarnings)) && Number(o.driverEarnings) > 0) {
    return Number(o.driverEarnings);
  }
  const delivery = Number(o.deliveryCost || o.shippingCost || o.deliveryFee || o.cost || 0);
  const purchaseFee = Number(o.purchaseFee || o.mandadoFee || o.managementFee || o.mandadoPersonalFee || o.gestionCost || 0);
  const extraStops = Number(o.extraStopsCost || o.extraStopsFee || o.paradasCost || 0);
  const rain = Number(o.rainSurcharge || o.deliveryRainSurcharge || o.recargoLluvia || (o.isRaining ? (getState().deliveryRainSurcharge || 300) : 0));
  const tip = Number(o.tip || o.tipAmount || o.propina || 0);
  const night = Number(o.nightSurcharge || o.nightFee || 0);
  const incentive = Number(o.incentiveAmount || o.incentive || 0);

  return delivery + purchaseFee + extraStops + rain + tip + night + incentive;
}

export function playExclusiveOfferAlert() {
  if (window.exclusiveAlertInterval) return;

  try {
    AudioManager.startDriverOfferLoop();
  } catch (err) {
    console.warn('Could not start offer loop sound:', err);
  }

  if (navigator.vibrate) {
    try { navigator.vibrate([600, 200, 600, 200, 600]); } catch (e) {}
  }

  window.exclusiveAlertInterval = setInterval(() => {
    if (navigator.vibrate) {
      try { navigator.vibrate([600, 200, 600, 200, 600]); } catch (e) {}
    }
  }, 2500);

  // Safety net: an offer lasts 60s. Whatever path started the alarm, it must never outlive
  // the offer (a late push after accepting used to leave the bell ringing forever).
  clearTimeout(window.exclusiveAlertSafetyTimer);
  window.exclusiveAlertSafetyTimer = setTimeout(stopExclusiveOfferAlert, 75000);
}

export function stopExclusiveOfferAlert() {
  clearTimeout(window.exclusiveAlertSafetyTimer);
  window.exclusiveAlertSafetyTimer = null;
  try {
    AudioManager.stopDriverOfferLoop();
  } catch (err) {
    console.warn('Could not stop loop sound:', err);
  }

  if (window.exclusiveAlertInterval) {
    clearInterval(window.exclusiveAlertInterval);
    window.exclusiveAlertInterval = null;
  }
  
  if (navigator.vibrate) {
    try { navigator.vibrate(0); } catch (e) {}
  }
}

export async function updateDispatchQueue(orderId) {
  try {
    const orderRef = doc(db, 'orders', orderId);
    const orderSnap = await getDoc(orderRef);
    if (!orderSnap.exists()) return;
    const o = orderSnap.data();
    if (o.driverId) return;

    if (!o.isFavor && !o.isTrip && o.status !== 'ready') {
      return;
    }

    const now = Date.now() + (getState().serverTimeOffset || 0);
    const offeredAt = o.queueOfferedAt 
      ? (o.queueOfferedAt.toMillis ? o.queueOfferedAt.toMillis() : new Date(o.queueOfferedAt).getTime())
      : null;

    if (o.queueTargetDriverId && offeredAt && (now - offeredAt < 58000)) {
      return;
    }

    const prevTargetDriverId = o.queueTargetDriverId || null;
    let manualRejected = [...(o.manuallyRejectedDrivers || [])];
    let offeredDrivers = [...(o.queueOfferedDrivers || o.queueRejectedDrivers || [])];

    if (prevTargetDriverId && !offeredDrivers.includes(prevTargetDriverId)) {
      offeredDrivers.push(prevTargetDriverId);
    }

    let nextDriverId = null;
    let nextDriverName = null;

    const targetDirectUid = o.directDriverUid || o.preferredDriverUid;
    if (targetDirectUid && targetDirectUid !== 'rotation' && !manualRejected.includes(targetDirectUid) && !offeredDrivers.includes(targetDirectUid)) {
      const directDriverSnap = await getDoc(doc(db, 'users', targetDirectUid));
      if (directDriverSnap.exists()) {
        const dData = directDriverSnap.data();
        nextDriverId = targetDirectUid;
        nextDriverName = dData.displayName || dData.name || 'Repartidor';
      }
    }

    if (!nextDriverId) {
      const usersSnap = await getDocs(collection(db, 'users'));
      const onlineDrivers = usersSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(u => (u.isDelivery === true || u.role === 'delivery' || u.role === 'driver' || u.role === 'chofer') && u.isOnline === true);

      if (onlineDrivers.length === 0) return;

      let candidates = onlineDrivers.filter(d => !offeredDrivers.includes(d.id) && !manualRejected.includes(d.id));

      if (candidates.length === 0) {
        const nonManualRejectingDrivers = onlineDrivers.filter(d => !manualRejected.includes(d.id));
        if (nonManualRejectingDrivers.length > 0) {
          offeredDrivers = [];
          candidates = nonManualRejectingDrivers;
        } else {
          offeredDrivers = [];
          candidates = onlineDrivers;
        }
      }

      const nextDriver = candidates.length > 0 ? candidates[0] : null;
      if (nextDriver) {
        nextDriverId = nextDriver.id;
        nextDriverName = nextDriver.name || nextDriver.displayName || 'Repartidor';
      }
    }

    if (nextDriverId) {
      await runTransaction(db, async (transaction) => {
        const freshSnap = await transaction.get(orderRef);
        if (!freshSnap.exists()) return;
        const freshData = freshSnap.data();
        if (freshData.driverId) return;

        transaction.update(orderRef, {
          queueTargetDriverId: nextDriverId,
          queueTargetDriverName: nextDriverName,
          queueOfferedAt: new Date(now),
          queueOfferedBy: 'client',
          queueOfferedDrivers: [...offeredDrivers, nextDriverId]
        });
      });
    }
  } catch (err) {
    console.error('Error updating dispatch queue:', err);
  }
}

let exclusiveModalCountdownInterval = null;

export function hideExclusiveOfferOverlay() {
  const existing = document.getElementById('exclusive-offer-fullscreen-overlay');
  if (existing) {
    existing.remove();
  }
  if (exclusiveModalCountdownInterval) {
    clearInterval(exclusiveModalCountdownInterval);
    exclusiveModalCountdownInterval = null;
  }
}

export function showExclusiveOfferOverlay(batch, user) {
  const currentUser = user || getState().user;
  const orderObj = batch.isBundle ? (batch.orders?.[0] || batch.order) : (batch.order || batch);
  if (!orderObj) return;

  const currentOrderId = orderObj.id || batch.id;
  const offeredAt = orderObj?.queueOfferedAt 
    ? (orderObj.queueOfferedAt.toMillis ? orderObj.queueOfferedAt.toMillis() : new Date(orderObj.queueOfferedAt).getTime()) 
    : (Date.now() + (getState().serverTimeOffset || 0));
  const currentOfferKey = `${currentOrderId}_${offeredAt}`;

  const existing = document.getElementById('exclusive-offer-fullscreen-overlay');
  if (existing) {
    if (existing.dataset.offerKey === currentOfferKey) {
      return; // Already actively displaying this exact offer instance
    }
    hideExclusiveOfferOverlay();
  }

  // Haptic feedback vibration alert on incoming offer
  try {
    if ('vibrate' in navigator) {
      navigator.vibrate([250, 100, 250, 100, 500]);
    }
  } catch (e) {}

  const isLight = document.body.classList.contains('light-theme') || (localStorage.getItem('gd_driver_theme') === 'light');
  const favorType = (orderObj.favorType || batch.favorType || orderObj.serviceType || batch.type || '').toString().toLowerCase();
  const isTrip = Boolean(batch.isTrip || orderObj.isTrip || batch.type === 'trip' || orderObj.serviceType === 'viaje' || favorType === 'viaje');
  const isGoCash = favorType === 'gocash' || Boolean(orderObj.isGoCash || batch.isGoCash);
  const isPagoServicios = favorType === 'pagodeservicios' || favorType === 'servicio' || favorType === 'servicios' || Boolean(orderObj.isServicePayment || batch.isServicePayment);
  const isEncomienda = isOrderEncomienda(orderObj) || isOrderEncomienda(batch.order) || isOrderEncomienda(batch) || favorType === 'encomienda' || favorType === 'mandado_paquete';
  const isMandado = (Boolean(orderObj.isFavor || batch.isFavor || batch.order?.isFavor) || favorType === 'mandado' || favorType === 'compra') && !isEncomienda && !isTrip && !isGoCash && !isPagoServicios;

  let typeBadgeLabel = 'COMERCIO';
  let typeBadgeIcon = '';
  let typeBadgeBg = '';
  let typeBadgeBorder = '';
  let typeBadgeColor = '';
  let typeBadgeSub = '';
  let originTitle = '';
  let originSubtitle = '';
  let originIcon = '';

  if (isGoCash) {
    typeBadgeLabel = 'GO CASH';
    typeBadgeIcon = `<img src="/go-cash.png?v=5" style="width:44px; height:44px; object-fit:contain; display:block; filter:drop-shadow(0 3px 8px rgba(0,0,0,0.18));" alt="Go Cash" />`;
    typeBadgeBg = isLight ? '#ecfdf5' : 'rgba(16, 185, 129, 0.18)';
    typeBadgeBorder = isLight ? '#a7f3d0' : 'rgba(16, 185, 129, 0.5)';
    typeBadgeColor = isLight ? '#059669' : '#34d399';
    typeBadgeSub = orderObj.details || orderObj.description || 'Entrega de dinero en efectivo';

    originIcon = `<img src="/go-cash.png?v=5" style="width:34px; height:34px; object-fit:contain; display:block;" alt="Go Cash" />`;
    originTitle = orderObj.pickupAddress || orderObj.originAddress || 'Punto de retiro de efectivo';
    originSubtitle = `Monto: ${money(goCashInfo(orderObj).amount)}`;
  } else if (isPagoServicios) {
    typeBadgeLabel = 'PAGO DE SERVICIO';
    typeBadgeIcon = `<img src="/go-clipboard.png?v=5" style="width:44px; height:44px; object-fit:contain; display:block; filter:drop-shadow(0 3px 8px rgba(0,0,0,0.18));" alt="Pago de Servicios" />`;
    typeBadgeBg = isLight ? '#eff6ff' : 'rgba(59, 130, 246, 0.18)';
    typeBadgeBorder = isLight ? '#bfdbfe' : 'rgba(59, 130, 246, 0.5)';
    typeBadgeColor = isLight ? '#2563eb' : '#60a5fa';
    typeBadgeSub = orderObj.details || orderObj.description || 'Pago de impuestos o facturas';

    originIcon = `<img src="/go-clipboard.png?v=5" style="width:34px; height:34px; object-fit:contain; display:block;" alt="Pago de Servicios" />`;
    originTitle = orderObj.pickupAddress || orderObj.originAddress || 'Punto de retiro de factura / fondos';
    originSubtitle = orderObj.serviceName || orderObj.companyName || 'Gestión de cobro y pago';
  } else if (isTrip) {
    typeBadgeLabel = 'VIAJE';
    typeBadgeIcon = `<img src="/go-car.jpg" style="width:44px; height:44px; border-radius:12px; object-fit:cover; display:block; box-shadow:0 3px 10px rgba(0,0,0,0.2);" alt="Viaje" />`;
    typeBadgeBg = isLight ? '#f0f9ff' : 'rgba(14, 165, 233, 0.18)';
    typeBadgeBorder = isLight ? '#bae6fd' : 'rgba(14, 165, 233, 0.5)';
    typeBadgeColor = isLight ? '#0284c7' : '#38bdf8';
    typeBadgeSub = 'Traslado exclusivo de pasajero';

    originIcon = `<img src="/go-car.jpg" style="width:34px; height:34px; border-radius:8px; object-fit:cover; display:block;" alt="Viaje" />`;
    originTitle = orderObj.originAddress || 'Punto de recogida';
    originSubtitle = `Pasajero: ${orderObj.userName || 'Pasajero'}`;
  } else if (isEncomienda) {
    typeBadgeLabel = 'ENCOMIENDA';
    typeBadgeIcon = `<img src="/go-pickup-point.png?v=5" style="width:44px; height:44px; object-fit:contain; display:block; filter:drop-shadow(0 3px 8px rgba(0,0,0,0.18));" alt="Encomienda" />`;
    typeBadgeBg = isLight ? '#fffbeb' : 'rgba(245, 158, 11, 0.18)';
    typeBadgeBorder = isLight ? '#fde68a' : 'rgba(245, 158, 11, 0.5)';
    typeBadgeColor = isLight ? '#b45309' : '#fbbf24';
    typeBadgeSub = cleanMandadoText(orderObj.details || orderObj.description || orderObj.itemsText || 'Envío de paquete o encomienda');

    originIcon = `<img src="/go-pickup-point.png?v=5" style="width:34px; height:34px; object-fit:contain; display:block;" alt="Encomienda" />`;
    originTitle = orderObj.pickupAddress || orderObj.originAddress || 'Dirección de Retiro';
    originSubtitle = cleanMandadoText(orderObj.details || orderObj.description || orderObj.itemsText || 'Paquete a retirar');
  } else if (isMandado) {
    const parsedM = parseMandadoDetails(orderObj.description || orderObj.itemsText || orderObj.notes || orderObj.details, orderObj.comercioName || orderObj.originAddress);
    typeBadgeLabel = 'MANDADO';
    typeBadgeIcon = `<img src="/go-bag.png?v=6" style="width:44px; height:44px; object-fit:contain; display:block; filter:drop-shadow(0 3px 8px rgba(0,0,0,0.18));" alt="GO! Mandado" />`;
    typeBadgeBg = isLight ? '#faf5ff' : 'rgba(168, 85, 247, 0.18)';
    typeBadgeBorder = isLight ? '#e9d5ff' : 'rgba(168, 85, 247, 0.5)';
    typeBadgeColor = isLight ? '#7e22ce' : '#c084fc';
    typeBadgeSub = parsedM.items || 'Compra en local / trámite';

    originIcon = `<img src="/go-bag.png?v=6" style="width:34px; height:34px; object-fit:contain; display:block;" alt="GO! Mandado" />`;
    originTitle = parsedM.comercio || orderObj.comercioName || 'Local de compra';
    originSubtitle = parsedM.items || 'Compra solicitada por el cliente';
  } else {
    // Comercio
    const commerceLogo = orderObj.comercioRealLogo || orderObj.comercioLogo || batch.comercioLogo || orderObj.comercioImage || batch.comercioImage || orderObj.logo || batch.logo || '/logo.png';
    const commerceName = batch.isBundle ? (batch.comercioName || 'Comercio') : (orderObj.comercioName || 'Comercio');
    const itemsList = Array.isArray(orderObj.items) ? orderObj.items : (Array.isArray(orderObj.products) ? orderObj.products : []);

    typeBadgeLabel = 'COMERCIO';
    typeBadgeIcon = `<img src="${commerceLogo}" onerror="this.onerror=null; this.src='/go-bag.png?v=6';" style="width:44px; height:44px; border-radius:12px; object-fit:cover; display:block; box-shadow:0 3px 10px rgba(0,0,0,0.18);" alt="${commerceName}" />`;
    typeBadgeBg = isLight ? '#fff1f2' : 'rgba(225, 29, 72, 0.16)';
    typeBadgeBorder = isLight ? '#fecdd3' : 'rgba(225, 29, 72, 0.45)';
    typeBadgeColor = isLight ? '#be123c' : '#fb7185';
    typeBadgeSub = `${commerceName} • Pedido en local`;

    originIcon = `<img src="${commerceLogo}" onerror="this.onerror=null; this.src='/go-bag.png?v=6';" style="width:34px; height:34px; border-radius:8px; object-fit:cover; display:block;" alt="${commerceName}" />`;
    originTitle = commerceName;
    originSubtitle = itemsList.length > 0 ? itemsList.map(it => `${it.quantity || it.cant || 1}x ${it.name || it.title}`).join(', ') : (orderObj.comercioAddress || 'Pedido en local');
  }

  const destAddress = batch.isBundle ? batch.orders.map(o => o.destinationAddress || o.address || o.deliveryAddress).join(' • ') : (orderObj.destinationAddress || orderObj.address || orderObj.deliveryAddress || 'Dirección de entrega');
  // En un lote se gana por cada pedido: se suman (antes se mostraba solo el primero)
  const driverEarnings = batch.isBundle && Array.isArray(batch.orders)
    ? batch.orders.reduce((sum, o) => sum + (Number(getOrderDriverEarnings(o)) || 0), 0)
    : getOrderDriverEarnings(batch.order || orderObj || batch);

  const TOTAL_DURATION = 60;
  const calcRemaining = () => {
    const now = Date.now() + (getState().serverTimeOffset || 0);
    const elapsed = Math.floor((now - offeredAt) / 1000);
    return Math.max(0, TOTAL_DURATION - elapsed);
  };

  // ── Oferta: hoja inferior sobre el mapa. Ganancia, paradas en orden, qué pasa con la plata
  // y las dos acciones siempre visibles. ──
  const t = driverTokens(isLight);
  const kind = orderKind(orderObj, { isTrip, isFavor: isMandado, isEncomienda, favorType: isGoCash ? 'gocash' : (isPagoServicios ? 'pagodeservicios' : favorType) });
  const kindLabel = batch.isBundle ? `Lote · ${batch.orders.length} pedidos` : kind.label;
  const clientName = orderObj.userName || orderObj.clientName || '';

  const stops = [];
  let shoppingPlan = null;
  if (isTrip) {
    stops.push({ kind: 'person', title: `Buscás a ${clientName || 'tu pasajero'}`, sub: orderObj.originAddress || orderObj.pickupAddress || '', state: 'next' });
    stops.push({ kind: 'dest', title: destAddress, sub: 'Destino del viaje', state: 'next' });
  } else if (batch.isBundle) {
    stops.push({ kind: 'store', title: batch.comercioName || orderObj.comercioName || 'Comercio', sub: `Retirás ${batch.orders.length} pedidos`, state: 'next' });
    batch.orders.forEach(o => stops.push({ kind: 'dest', title: o.destinationAddress || o.address || o.deliveryAddress || 'Entrega', sub: o.userName ? `Entrega a ${o.userName}` : '', state: 'next' }));
  } else if (isMandado || isPagoServicios) {
    // Cada comercio del mandado, en el orden en que conviene hacerlos
    const src = isPagoServicios && !(Array.isArray(orderObj.mandadoStops) && orderObj.mandadoStops.length)
      ? { ...orderObj, mandadoStops: [{ store: String(originTitle).replace(/\s*\(.*\)\s*$/, ''), items: '' }] }
      : orderObj;
    shoppingPlan = mandadoShoppingPlan(src, window.lastRiderPos || null);
    if (shoppingPlan.stores.length) {
      shoppingPlan.pending.forEach(st => stops.push({
        kind: 'store',
        title: st.placeName || st.store,
        sub: [st.nearest ? `Cualquier ${categoryLabel(st.nearest)}: la más cercana` : (st.coords ? (st.placeAddress || '') : 'Ubicación a confirmar'), st.items].filter(Boolean).join(' · '),
        state: 'next',
      }));
    } else {
      stops.push({ kind: 'store', title: originTitle, sub: originSubtitle, state: 'next' });
    }
    stops.push({ kind: 'dest', title: destAddress, sub: clientName ? `Entrega a ${clientName}` : '', state: 'next' });
  } else {
    // Go Cash no tiene retiro: el repartidor sale con el efectivo (o la cuenta) hacia el cliente
    if (!isGoCash) {
      stops.push({ kind: isEncomienda ? 'pkg' : 'store', title: originTitle, sub: originSubtitle, state: 'next' });
    }
    stops.push({ kind: 'dest', title: destAddress, sub: clientName ? `Entrega a ${clientName}` : '', state: 'next' });
  }

  // Distancia aproximada: repartidor → retiro(s) → entrega. El "retiro" de los formularios de
  // mandados es el centro del pueblo: no se usa; se suman solo los comercios que se sabe dónde quedan.
  const dc = dropoffCoordsOf(orderObj);
  let waypoints;
  if (shoppingPlan) waypoints = shoppingPlan.pending.filter(st => st.coords).map(st => st.coords);
  else {
    const pc = isGoCash ? null : pickupCoordsOf(orderObj);
    waypoints = pc && !isPlaceholderCoords(pc) ? [pc] : [];
  }
  let km = 0, haveKm = false, from = window.lastRiderPos || null;
  for (const pt of [...waypoints, dc]) {
    if (!pt) continue;
    const leg = kmBetween(from, pt);
    if (leg != null) { km += leg; haveKm = true; }
    from = pt;
  }
  const metaLines = [];
  if (batch.isBundle) metaLines.push(`${batch.orders.length} entregas`);
  if (haveKm) { metaLines.push(kmLabel(km)); metaLines.push(`~${Math.max(3, Math.round(km * 2.6))} min`); }

  // Qué pasa con la plata en este tipo de pedido
  const orderTotal = batch.isBundle ? batch.total : (orderObj.totalAmount || orderObj.total || batch.total || 0);
  const rows = [];
  if (isGoCash) {
    const g = goCashInfo(orderObj);
    rows.push(g.driverBringsCash
      ? moneyRow({ label: 'Llevás en efectivo', amount: g.amount > 0 ? money(g.amount) : '', sub: 'El cliente te lo transfiere al recibirlo', tone: 'violet', icon: 'swap' }, isLight)
      : moneyRow({ label: 'Recibís en efectivo', amount: g.amount > 0 ? money(g.amount) : '', sub: 'Le transferís ese monto al cliente', tone: 'violet', icon: 'swap' }, isLight));
    rows.push(moneyRow({ label: 'Cobrás el envío', amount: money(orderTotal), sub: 'Aparte del cambio', tone: 'amber' }, isLight));
  } else {
    if (isMandado) {
      const buy = Number(orderObj.purchaseCost ?? orderObj.purchaseItemsTotal ?? batch.subtotal ?? 0);
      rows.push(moneyRow({ label: 'Adelantás la compra', amount: buy > 0 ? `~ ${money(buy)}` : '', sub: 'Te la devuelve el cliente al entregar', tone: 'amber', icon: 'bag' }, isLight));
    }
    // Siempre se cobra al entregar: en efectivo o por transferencia al alias del repartidor
    if (batch.isBundle) {
      const sum = (list) => list.reduce((s, o) => s + (Number(o.totalAmount || o.total) || 0), 0);
      const cash = batch.orders.filter(isCashPayment), transfer = batch.orders.filter(o => !isCashPayment(o));
      const parts = [cash.length ? `${money(sum(cash))} en efectivo` : '', transfer.length ? `${money(sum(transfer))} por transferencia` : ''].filter(Boolean);
      rows.push(moneyRow({ label: 'Cobrás al entregar', amount: money(sum(batch.orders)), sub: parts.join(' · '), tone: 'amber' }, isLight));
    } else if (isCashPayment(orderObj)) {
      rows.push(moneyRow({ label: isTrip ? 'Cobrás al terminar' : 'Cobrás en efectivo', amount: money(orderTotal), sub: isTrip ? 'En efectivo' : 'El cliente paga al recibir', tone: 'amber' }, isLight));
    } else {
      rows.push(moneyRow({ label: isTrip ? 'Cobrás al terminar' : 'Cobrás por transferencia', amount: money(orderTotal), sub: 'A tu alias, cuando recibe el pedido', tone: 'amber', icon: 'swap' }, isLight));
    }
  }
  if (orderObj.isScheduled) {
    rows.push(infoRow('calendar', `Programado: ${orderObj.scheduledDate || ''} a las ${orderObj.scheduledTime || ''} hs`, isLight, 'brand'));
  }

  if (!document.getElementById('go-offer-sheet-styles')) {
    const st = document.createElement('style');
    st.id = 'go-offer-sheet-styles';
    st.textContent = `
      @keyframes goOfferUp { from { transform: translateY(100%); } to { transform: none; } }
      @keyframes goOfferFade { from { opacity: 0; } to { opacity: 1; } }
      #exclusive-offer-fullscreen-overlay button:active { transform: scale(0.98); }
      @media (prefers-reduced-motion: reduce) { #exclusive-offer-fullscreen-overlay, #exclusive-offer-fullscreen-overlay .exclusive-offer-card { animation: none !important; } }
    `;
    document.head.appendChild(st);
  }

  const overlay = document.createElement('div');
  overlay.id = 'exclusive-offer-fullscreen-overlay';
  overlay.dataset.orderId = currentOrderId;
  overlay.dataset.offerKey = currentOfferKey;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Nueva oferta de pedido');
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 999999;
    background: ${t.scrim};
    display: flex; align-items: flex-end; justify-content: center;
    font-family: 'Inter', system-ui, -apple-system, sans-serif;
    box-sizing: border-box; touch-action: none;
    animation: goOfferFade 0.2s ease-out;
  `;

  const acceptLabel = batch.isBundle ? `Aceptar los ${batch.orders.length}` : 'Aceptar';
  overlay.innerHTML = `
    <div class="exclusive-offer-card" style="
      max-width: 480px; width: 100%; box-sizing: border-box; position: relative;
      background: ${t.sheet}; border-top: 1px solid ${t.line}; border-radius: 24px 24px 0 0;
      padding: 10px 20px calc(20px + env(safe-area-inset-bottom));
      display: flex; flex-direction: column; gap: 16px; box-shadow: ${t.shadow};
      max-height: 92vh; overflow-y: auto; color: ${t.tx};
      animation: goOfferUp 0.28s cubic-bezier(0.16, 1, 0.3, 1);
    ">
      <div style="width: 40px; height: 4px; border-radius: 2px; background: ${t.handle}; align-self: center;"></div>
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px;">
        <div style="display: flex; flex-direction: column; gap: 6px; min-width: 0;">
          ${kindTag(kind, isLight, kindLabel)}
          <span style="font-size: 13px; font-weight: 600; color: ${t.tx3};">Nuevo pedido para vos</span>
        </div>
        ${countdownRing(calcRemaining(), TOTAL_DURATION, isLight, { ring: 'exclusive-modal-ring', num: 'exclusive-modal-countdown' })}
      </div>
      <div style="display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; margin-top: -4px;">
        <div>
          <div style="font-size: 13px; color: ${t.tx3};">Tu ganancia</div>
          <div style="font-family: var(--font-display, 'Outfit', sans-serif); font-size: 40px; font-weight: 700; line-height: 1.05; letter-spacing: -0.01em; color: ${t.tx};">${esc(formatPrice(driverEarnings))}</div>
        </div>
        ${metaLines.length ? `<div style="text-align: right; font-size: 14px; color: ${t.tx2}; line-height: 1.5;">${metaLines.map(esc).join('<br>')}</div>` : ''}
      </div>
      ${stopsList(stops, isLight)}
      ${rows.join('')}
      <div style="display: flex; gap: 10px;">
        <button id="fullscreen-reject-offer-btn" style="height: 56px; padding: 0 18px; border-radius: 16px; background: ${t.card}; border: 1px solid ${t.line}; color: ${t.tx2}; font-size: 15px; font-weight: 600; cursor: pointer; font-family: inherit;">Rechazar</button>
        <button id="fullscreen-accept-offer-btn" style="flex: 1; height: 56px; border-radius: 16px; background: ${t.brand}; color: #FFFFFF; border: 0; font-family: var(--font-display, 'Outfit', sans-serif); font-size: 18px; font-weight: 600; cursor: pointer;">${esc(acceptLabel)}</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  playExclusiveOfferAlert();

  if (exclusiveModalCountdownInterval) clearInterval(exclusiveModalCountdownInterval);
  exclusiveModalCountdownInterval = setInterval(() => {
    const rem = calcRemaining();
    const cdEl = document.getElementById('exclusive-modal-countdown');
    const ringEl = document.getElementById('exclusive-modal-ring');
    if (cdEl) {
      cdEl.textContent = rem;
      if (rem <= 10) cdEl.style.color = '#F43F5E';
    }
    if (ringEl) ringEl.style.strokeDashoffset = (RING_C * (1 - Math.max(0, Math.min(1, rem / TOTAL_DURATION)))).toFixed(1);
    if (rem <= 0) {
      const orderIdToRotate = orderObj.id || batch.id;
      hideExclusiveOfferOverlay();
      stopExclusiveOfferAlert();
      updateDispatchQueue(orderIdToRotate).catch(console.warn);
      return;
    }
  }, 1000);

  const acceptBtn = overlay.querySelector('#fullscreen-accept-offer-btn');
  if (acceptBtn) {
    acceptBtn.onclick = async () => {
      // Immediate visual feedback with spinner
      const modalBox = overlay.querySelector('.exclusive-offer-card') || overlay.firstElementChild;
      let loader = overlay.querySelector('#offer-accept-loader-screen');
      if (!loader && modalBox) {
        loader = document.createElement('div');
        loader.id = 'offer-accept-loader-screen';
        loader.style.cssText = `
          position: absolute;
          inset: 0;
          background: ${t.sheet};
          border-radius: 24px 24px 0 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          z-index: 100;
          padding: 24px;
          text-align: center;
        `;
        loader.innerHTML = `
          <div style="width: 48px; height: 48px; border: 4px solid ${t.line}; border-top-color: ${t.brand}; border-radius: 50%; animation: spin 0.8s linear infinite; margin-bottom: 16px;"></div>
          <h3 style="font-family: var(--font-display, 'Outfit', sans-serif); font-size: 20px; font-weight: 600; color: ${t.tx}; margin: 0 0 4px 0;">Pedido aceptado</h3>
          <p style="font-size: 14px; color: ${t.tx2}; margin: 0;">Preparando tu recorrido…</p>
        `;
        modalBox.appendChild(loader);
      }

      try {
        window._animatePickupPill = true;
        const { takeBatch } = await import('../pages/delivery-panel.js');
        const accepted = await takeBatch(batch.id, currentUser, batch, acceptBtn);
        if (accepted === false) {
          // takeBatch already told the driver why. Keep the offer on screen so they can retry
          // (a network blip used to close it and the order was silently lost), but stop the
          // alarm: the driver is already looking at it.
          if (loader) loader.remove();
          stopExclusiveOfferAlert();
          return;
        }
      } catch (err) {
        console.error('[Accept batch error]', err);
        if (loader) loader.remove();
        showToast(err.message || 'No se pudo aceptar el pedido.', 'error');
        return;
      }

      stopExclusiveOfferAlert();
      hideExclusiveOfferOverlay();
    };
  }

  const rejectBtn = overlay.querySelector('#fullscreen-reject-offer-btn');
  if (rejectBtn) {
    rejectBtn.onclick = async () => {
      stopExclusiveOfferAlert();
      hideExclusiveOfferOverlay();
      showToast('Pedido rechazado. Pasando al siguiente repartidor...', 'info');

      try {
        const orderIds = batch.isBundle ? (batch.orders || []).map(o => o.id) : [orderObj.id || batch.id];

        await runTransaction(db, async (transaction) => {
          for (const oId of orderIds) {
            if (!oId) continue;
            const orderRef = doc(db, 'orders', oId);
            const oSnap = await transaction.get(orderRef);
            if (oSnap.exists()) {
              const data = oSnap.data();
              const manualRejected = data.manuallyRejectedDrivers || [];
              const passiveRejected = data.queueRejectedDrivers || [];
              if (currentUser?.uid) {
                if (!manualRejected.includes(currentUser.uid)) manualRejected.push(currentUser.uid);
                if (!passiveRejected.includes(currentUser.uid)) passiveRejected.push(currentUser.uid);
              }
              transaction.update(orderRef, {
                manuallyRejectedDrivers: manualRejected,
                queueRejectedDrivers: passiveRejected,
                queueTargetDriverId: null,
                queueTargetDriverName: null,
                queueOfferedAt: null,
                isPermanentOffer: null
              });
            }
          }
        });

        for (const oId of orderIds) {
          if (oId) {
            if (window.expiredLocalOrders) window.expiredLocalOrders.add(oId);
            updateDispatchQueue(oId).catch(console.warn);
          }
        }
      } catch (err) {
        console.error('Error rejecting order offer:', err);
      }
    };
  }
}
