// GoDelivery — Exclusive Offer Modal Component (0ms Instant Popup)
import { getState } from '../state.js';
import { formatPrice } from '../utils/format.js';
import { AudioManager } from '../utils/audio-manager.js';
import { showToast } from '../components/toast.js';
import { db } from '../firebase.js';
import { doc, getDoc, getDocs, collection, runTransaction } from 'firebase/firestore';

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
    originSubtitle = `Monto a entregar: $${Number(orderObj.amount || orderObj.cashAmount || orderObj.totalAmount || 0).toLocaleString('es-AR')}`;
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

  let destAddress = batch.isBundle ? batch.orders.map(o => o.destinationAddress || o.address || o.deliveryAddress).join(' • ') : (orderObj.destinationAddress || orderObj.address || orderObj.deliveryAddress || 'Dirección de entrega');
  let driverEarnings = getOrderDriverEarnings(batch.order || orderObj || batch);

  const TOTAL_DURATION = 60;
  const calcRemaining = () => {
    const now = Date.now() + (getState().serverTimeOffset || 0);
    const elapsed = Math.floor((now - offeredAt) / 1000);
    return Math.max(0, TOTAL_DURATION - elapsed);
  };

  const overlay = document.createElement('div');
  overlay.id = 'exclusive-offer-fullscreen-overlay';
  overlay.dataset.orderId = currentOrderId;
  overlay.dataset.offerKey = currentOfferKey;
  overlay.style.cssText = `
    position: fixed;
    inset: 0;
    z-index: 999999;
    background: rgba(0, 0, 0, 0.72);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
    font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    box-sizing: border-box;
    overflow-y: auto;
    touch-action: none;
  `;

  overlay.innerHTML = `
    <!-- Floating Badge Modal Card -->
    <div class="exclusive-offer-card" style="
      max-width: 420px;
      width: 100%;
      background: ${isLight ? '#ffffff' : '#080C14'};
      border: 1.5px solid ${isLight ? '#e2e8f0' : 'rgba(255, 255, 255, 0.14)'};
      border-radius: 32px;
      padding: 22px 20px;
      box-shadow: ${isLight ? '0 25px 70px rgba(0, 0, 0, 0.2), 0 0 0 1px rgba(0, 0, 0, 0.04)' : '0 25px 70px rgba(0, 0, 0, 0.95), 0 0 0 1px rgba(255, 255, 255, 0.05)'};
      display: flex;
      flex-direction: column;
      gap: 12px;
      box-sizing: border-box;
      position: relative;
      animation: modalPop 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    ">
      <!-- Top Header -->
      <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
        <div style="display: flex; align-items: center; gap: 7px; background: ${isLight ? '#fff1f2' : 'rgba(225, 29, 72, 0.15)'}; border: 1.5px solid ${isLight ? '#fecdd3' : 'rgba(225, 29, 72, 0.35)'}; padding: 7px 13px; border-radius: 99px;">
          <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #e11d48; box-shadow: 0 0 10px #e11d48;"></span>
          <span style="font-size: 11px; font-weight: 900; color: #e11d48; text-transform: uppercase; letter-spacing: 0.04em;">🚨 NUEVO PEDIDO EXCLUSIVO</span>
        </div>
        
        <div style="background: ${isLight ? '#f1f5f9' : 'rgba(255, 255, 255, 0.08)'}; color: ${isLight ? '#0f172a' : 'white'}; border: 1px solid ${isLight ? '#cbd5e1' : 'rgba(255, 255, 255, 0.14)'}; padding: 6px 13px; border-radius: 99px; font-weight: 900; font-size: 13.5px; font-variant-numeric: tabular-nums;">
          ⏳ <span id="exclusive-modal-countdown">${calcRemaining()}</span>s
        </div>
      </div>

      <!-- EXPLICIT ORDER TYPE BADGE -->
      <div style="
        display: flex; align-items: center; justify-content: space-between; gap: 10px;
        background: ${typeBadgeBg};
        border: 1.5px solid ${typeBadgeBorder};
        padding: 10px 14px;
        border-radius: 20px;
        box-shadow: ${isLight ? '0 2px 8px rgba(0,0,0,0.04)' : '0 4px 16px rgba(0, 0, 0, 0.4)'};
      ">
        <div style="display: flex; align-items: center; gap: 12px; min-width: 0; flex: 1;">
          <div style="width: 48px; height: 48px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
            ${typeBadgeIcon}
          </div>
          <div style="min-width: 0; flex: 1;">
            <div style="font-size: 14px; font-weight: 950; color: ${typeBadgeColor}; text-transform: uppercase; letter-spacing: 0.05em;">
              PEDIDO: ${typeBadgeLabel}
            </div>
            ${typeBadgeSub ? `
              <div style="font-size: 11.5px; font-weight: 700; color: ${isLight ? '#475569' : '#cbd5e1'}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px;">
                ${typeBadgeSub}
              </div>
            ` : ''}
          </div>
        </div>
        <div style="background: ${isLight ? '#ffffff' : 'rgba(255, 255, 255, 0.12)'}; border: 1px solid ${isLight ? '#e2e8f0' : 'transparent'}; padding: 4px 8px; border-radius: 8px; font-size: 10px; font-weight: 900; color: ${isLight ? '#334155' : 'white'}; text-transform: uppercase; letter-spacing: 0.04em; flex-shrink: 0;">
          ASIGNADO
        </div>
      </div>

      <!-- PROGRESS BAR LINE -->
      <div style="width: 100%; height: 5px; background: ${isLight ? '#e2e8f0' : 'rgba(255, 255, 255, 0.08)'}; border-radius: 99px; overflow: hidden; margin-top: -2px; margin-bottom: 2px;">
        <div id="exclusive-modal-progress-bar" style="
          width: ${(calcRemaining() / TOTAL_DURATION) * 100}%;
          height: 100%;
          background: linear-gradient(90deg, #10B981 0%, #22C55E 70%, #E11D48 100%);
          border-radius: 99px;
          transition: width 1s linear;
          box-shadow: 0 0 10px rgba(34, 197, 94, 0.6);
        "></div>
      </div>

      <!-- Earnings Card -->
      <div style="
        background: linear-gradient(135deg, #10B981 0%, #059669 100%);
        border-radius: 24px;
        padding: 18px 16px;
        text-align: center;
        color: white;
        box-shadow: 0 12px 30px rgba(16, 185, 129, 0.38), inset 0 1px 1px rgba(255,255,255,0.4);
        position: relative;
        overflow: hidden;
      ">
        <div style="position:absolute; top:-30px; left:-30px; width:120px; height:120px; background:radial-gradient(circle, rgba(255,255,255,0.3) 0%, rgba(255,255,255,0) 70%); pointer-events:none;"></div>
        <div style="font-size: 11px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.1em; opacity: 0.95; margin-bottom: 2px;">Tu Ganancia Estimada</div>
        <div style="font-size: 42px; font-weight: 950; letter-spacing: -1.5px; text-shadow: 0 2px 10px rgba(0,0,0,0.2);">${formatPrice(driverEarnings)}</div>
      </div>

      <!-- Route Info Card -->
      <div style="background: ${isLight ? '#f8fafc' : 'rgba(255, 255, 255, 0.035)'}; border: 1px solid ${isLight ? '#e2e8f0' : 'rgba(255, 255, 255, 0.08)'}; border-radius: 22px; padding: 16px 14px; color: ${isLight ? '#0f172a' : 'white'}; display: flex; flex-direction: column; gap: 12px;">
        <!-- Origin -->
        <div style="display: flex; gap: 12px; align-items: flex-start;">
          <div style="background: ${isLight ? '#fff1f2' : 'rgba(225, 29, 72, 0.16)'}; border: 1px solid ${isLight ? '#fecdd3' : 'rgba(225, 29, 72, 0.35)'}; border-radius: 14px; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; font-size: 18px; flex-shrink: 0; overflow: hidden;">
            ${originIcon}
          </div>
          <div style="flex: 1; min-width: 0;">
            <div style="font-size: 10px; font-weight: 850; color: ${isLight ? '#64748b' : '#94a3b8'}; text-transform: uppercase; letter-spacing: 0.05em;">Retiro (Origen)</div>
            <div style="font-size: 15.5px; font-weight: 900; color: ${isLight ? '#0f172a' : '#f8fafc'}; margin-top: 2px; line-height: 1.25; word-break: break-word;">${originTitle}</div>
            ${originSubtitle ? `<div style="font-size: 11.5px; font-weight: 700; color: ${isLight ? '#475569' : '#cbd5e1'}; margin-top: 2px; line-height: 1.3;">${originSubtitle}</div>` : ''}
          </div>
        </div>

        <div style="width: 100%; height: 1px; background: ${isLight ? '#e2e8f0' : 'rgba(255, 255, 255, 0.08)'};"></div>

        <!-- Destination -->
        <div style="display: flex; gap: 12px; align-items: flex-start;">
          <div style="background: ${isLight ? '#ecfdf5' : 'rgba(34, 197, 94, 0.16)'}; border: 1px solid ${isLight ? '#a7f3d0' : 'rgba(34, 197, 94, 0.35)'}; border-radius: 14px; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; font-size: 18px; flex-shrink: 0;">📍</div>
          <div style="flex: 1; min-width: 0;">
            <div style="font-size: 10px; font-weight: 850; color: ${isLight ? '#64748b' : '#94a3b8'}; text-transform: uppercase; letter-spacing: 0.05em;">Entrega (Destino)</div>
            <div style="font-size: 14.5px; font-weight: 800; color: ${isLight ? '#0f172a' : '#e2e8f0'}; margin-top: 2px; line-height: 1.35; word-break: break-word;">${destAddress}</div>
          </div>
        </div>
      </div>

      <!-- Bottom Actions -->
      <div style="display: flex; flex-direction: column; gap: 10px; width: 100%; margin-top: 4px;">
        <button id="fullscreen-accept-offer-btn" style="width: 100%; height: 58px; border-radius: 20px; background: linear-gradient(135deg, #10B981 0%, #059669 100%); color: white; font-size: 16.5px; font-weight: 950; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 9px; box-shadow: 0 10px 25px rgba(16, 185, 129, 0.4); letter-spacing: 0.03em; text-transform: uppercase; transition: transform 0.15s ease;">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><rect x="2" y="6" width="20" height="12" rx="3"/><circle cx="12" cy="12" r="3"/><path d="M6 12h.01M18 12h.01"/></svg>
          <span>ACEPTAR ${typeBadgeLabel} AHORA</span>
        </button>
        
        <button id="fullscreen-reject-offer-btn" style="width: 100%; height: 48px; border-radius: 16px; background: ${isLight ? '#fff1f2' : 'rgba(239, 68, 68, 0.12)'}; color: ${isLight ? '#be123c' : '#f43f5e'}; font-size: 13.5px; font-weight: 900; border: 1.5px solid ${isLight ? '#fecdd3' : 'rgba(239, 68, 68, 0.3)'}; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; text-transform: uppercase; transition: all 0.15s ease;">
          ✕ RECHAZAR PEDIDO
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  playExclusiveOfferAlert();

  if (exclusiveModalCountdownInterval) clearInterval(exclusiveModalCountdownInterval);
  exclusiveModalCountdownInterval = setInterval(() => {
    const rem = calcRemaining();
    const cdEl = document.getElementById('exclusive-modal-countdown');
    const barEl = document.getElementById('exclusive-modal-progress-bar');
    if (cdEl) cdEl.textContent = rem;
    if (barEl) {
      const pct = Math.max(0, Math.min(100, (rem / TOTAL_DURATION) * 100));
      barEl.style.width = pct + '%';
      if (rem <= 8) {
        barEl.style.background = '#F43F5E';
        barEl.style.boxShadow = '0 0 12px rgba(244, 63, 94, 0.9)';
      }
    }
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
          background: rgba(9, 13, 22, 0.96);
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          border-radius: 32px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          z-index: 100;
          padding: 24px;
          text-align: center;
        `;
        loader.innerHTML = `
          <div style="width: 54px; height: 54px; border: 4px solid rgba(255,255,255,0.1); border-top-color: #22C55E; border-radius: 50%; animation: spin 0.8s linear infinite; margin-bottom: 18px;"></div>
          <h3 style="font-size: 20px; font-weight: 950; color: white; margin: 0 0 6px 0;">¡Asignando Pedido!</h3>
          <p style="font-size: 13.5px; color: #94a3b8; margin: 0; font-weight: 600;">Cargando tu hoja de ruta y mapa de entrega...</p>
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
