// Driver safety and help bottom-sheet modals for the driver panel.
// Extracted from delivery-panel.js so this code is only fetched/parsed when the
// driver actually opens one of these, instead of on every panel load.
import { getState } from '../../state.js';
import { icon } from '../../utils/icons.js';
import { getDriverMapTheme } from '../../components/driver-navigation-map.js';

export async function showDriverSafetyModal(user) {
  const { showModal, closeModal } = await import('../../components/modal.js');
  const isLight = getDriverMapTheme() === 'light';
  const latestUser = getState().user || user || {};
  const driverName = latestUser.displayName || latestUser.name || 'Repartidor GoDelivery';

  const modalEl = document.createElement('div');
  modalEl.style.cssText = `
    padding: 16px 18px calc(24px + env(safe-area-inset-bottom, 16px)) 18px;
    background: var(--driver-bg-panel);
    color: var(--driver-text-primary);
    display: flex;
    flex-direction: column;
    gap: 14px;
    font-family: var(--font-body, sans-serif);
  `;

  const getGpsShareUrl = () => {
    const pos = window.lastRiderPos;
    if (pos && pos.lat && pos.lng) {
      return `https://maps.google.com/?q=${pos.lat},${pos.lng}`;
    }
    return 'https://maps.google.com/?q=-35.0815,-57.5147';
  };

  modalEl.innerHTML = `
    <!-- HEADER ALERT BANNER -->
    <div style="
      background: linear-gradient(135deg, rgba(239,68,68,0.15) 0%, rgba(220,38,38,0.2) 100%);
      border: 1.5px solid rgba(239,68,68,0.35);
      border-radius: 18px; padding: 14px;
      display: flex; align-items: center; gap: 12px;
    ">
      <div style="width:44px; height:44px; border-radius:12px; background:#ef4444; color:white; display:flex; align-items:center; justify-content:center; flex-shrink:0; box-shadow:0 4px 14px rgba(239,68,68,0.4);">
        ${icon('shield', 22)}
      </div>
      <div>
        <div style="font-size:14px; font-weight:900; color:${isLight ? '#991b1b' : '#fca5a5'};">Centro de Seguridad & Emergencias</div>
        <div style="font-size:11px; color:${isLight ? '#b91c1c' : '#fecaca'}; margin-top:2px;">Asistencia inmediata en Magdalena 24/7</div>
      </div>
    </div>

    <!-- ACTION 1: 911 / COMISARIA MAGDALENA -->
    <div style="display:flex; flex-direction:column; gap:8px;">
      <a href="tel:911" style="
        display: flex; align-items: center; justify-content: space-between; padding: 14px 16px;
        background: linear-gradient(135deg, #ef4444 0%, #b91c1c 100%);
        border-radius: 16px; text-decoration: none; color: white;
        box-shadow: 0 6px 20px rgba(239,68,68,0.35); transition: transform 0.15s;
      ">
        <div style="display:flex; align-items:center; gap:12px;">
          <div style="width:38px; height:38px; border-radius:10px; background:rgba(255,255,255,0.2); display:flex; align-items:center; justify-content:center;">
            ${icon('alertTriangle', 18)}
          </div>
          <div>
            <div style="font-size:14px; font-weight:950;">Llamar al 911 (Emergencias)</div>
            <div style="font-size:11px; opacity:0.9; margin-top:1px;">Central Telefónica de Emergencias</div>
          </div>
        </div>
        <div style="font-size:18px; font-weight:900;">➔</div>
      </a>

      <!-- Direct Comisaria Magdalena Number -->
      <a href="tel:02221452413" style="
        display: flex; align-items: center; justify-content: space-between; padding: 12px 16px;
        background: ${isLight ? '#fff1f2' : 'rgba(239,68,68,0.12)'};
        border: 1.5px solid ${isLight ? '#fecdd3' : 'rgba(239,68,68,0.3)'};
        border-radius: 14px; text-decoration: none; color: ${isLight ? '#9f1239' : '#fca5a5'};
        font-weight: 800; font-size: 13px;
      ">
        <div style="display:flex; align-items:center; gap:10px;">
          <span style="display:inline-flex;">${icon('car', 15)}</span>
          <span>Comisaría Magdalena: <strong>(02221) 45-2413</strong></span>
        </div>
        <span style="font-size:11.5px; background:#e11d48; color:white; padding:3px 9px; border-radius:8px; font-weight:900;">LLAMAR</span>
      </a>
    </div>

    <!-- ACTION 2: SAME / HOSPITAL MAGDALENA -->
    <div style="display:flex; flex-direction:column; gap:8px;">
      <a href="tel:107" style="
        display: flex; align-items: center; justify-content: space-between; padding: 14px 16px;
        background: linear-gradient(135deg, #059669 0%, #047857 100%);
        border-radius: 16px; text-decoration: none; color: white;
        box-shadow: 0 6px 20px rgba(5,150,105,0.3); transition: transform 0.15s;
      ">
        <div style="display:flex; align-items:center; gap:12px;">
          <div style="width:38px; height:38px; border-radius:10px; background:rgba(255,255,255,0.2); display:flex; align-items:center; justify-content:center;">
            ${icon('activity', 18)}
          </div>
          <div>
            <div style="font-size:14px; font-weight:950;">Llamar al 107 (SAME)</div>
            <div style="font-size:11px; opacity:0.9; margin-top:1px;">Ambulancias y Urgencias Médicas</div>
          </div>
        </div>
        <div style="font-size:18px; font-weight:900;">➔</div>
      </a>

      <!-- Direct Hospital Magdalena Number -->
      <a href="tel:02221453388" style="
        display: flex; align-items: center; justify-content: space-between; padding: 12px 16px;
        background: ${isLight ? '#ecfdf5' : 'rgba(5,150,105,0.12)'};
        border: 1.5px solid ${isLight ? '#a7f3d0' : 'rgba(5,150,105,0.3)'};
        border-radius: 14px; text-decoration: none; color: ${isLight ? '#065f46' : '#6ee7b7'};
        font-weight: 800; font-size: 13px;
      ">
        <div style="display:flex; align-items:center; gap:10px;">
          <span style="display:inline-flex;">${icon('activity', 15)}</span>
          <span>Hospital Magdalena: <strong>(02221) 45-3388</strong></span>
        </div>
        <span style="font-size:11.5px; background:#059669; color:white; padding:3px 9px; border-radius:8px; font-weight:900;">LLAMAR</span>
      </a>
    </div>

    <!-- ACTION 3: SHARE GPS LOCATION BY WHATSAPP -->
    <button id="safety-share-gps-btn" style="
      display: flex; align-items: center; justify-content: space-between; padding: 14px 16px;
      background: ${isLight ? '#f0fdf4' : 'rgba(34, 197, 94, 0.12)'};
      border: 1.5px solid ${isLight ? '#86efac' : 'rgba(34, 197, 94, 0.35)'};
      border-radius: 16px; color: ${isLight ? '#15803d' : '#4ade80'};
      font-size: 13.5px; font-weight: 900; cursor: pointer; text-align: left;
      transition: all 0.15s;
    ">
      <div style="display:flex; align-items:center; gap:12px;">
        <div style="width:38px; height:38px; border-radius:10px; background:${isLight ? '#dcfce7' : 'rgba(34, 197, 94, 0.2)'}; display:flex; align-items:center; justify-content:center;">
          ${icon('mapPin', 18)}
        </div>
        <div>
          <div>Compartir mi Ubicación GPS en Vivo</div>
          <div style="font-size:11px; font-weight:600; opacity:0.85; margin-top:1px;">Enviar alerta con coordenadas por WhatsApp</div>
        </div>
      </div>
      <div style="display:flex;">${icon('smartphone', 18)}</div>
    </button>

    <!-- ACTION 4: DIRECT GODELIVERY DISPATCH SUPPORT -->
    <button id="safety-support-btn" style="
      display: flex; align-items: center; justify-content: center; gap: 8px; padding: 14px 16px;
      background: var(--driver-fill-subtle);
      border: 1px solid var(--driver-border-strong);
      border-radius: 16px; color: var(--driver-text-primary);
      font-size: 13px; font-weight: 800; cursor: pointer;
    ">
      <span style="display:inline-flex;">${icon('headset', 15)}</span> <span>Abrir Chat con Soporte GoDelivery</span>
    </button>
  `;

  showModal({
    title: `<span style="display:inline-flex; vertical-align:middle; margin-right:6px;">${icon('shield', 20)}</span>Seguridad del Repartidor`,
    content: modalEl,
    height: 'auto',
    headerBackground: isLight ? '#ffffff' : '#090d16',
    headerTextColor: isLight ? '#0f172a' : '#ffffff'
  });

  const shareGpsBtn = modalEl.querySelector('#safety-share-gps-btn');
  if (shareGpsBtn) {
    shareGpsBtn.onclick = () => {
      const gpsLink = getGpsShareUrl();
      const msg = encodeURIComponent(
        `🚨 *EMERGENCIA REPARTIDOR GODELIVERY*\n` +
        `👤 *Repartidor:* ${driverName}\n` +
        `📍 *Mi Ubicación GPS en Vivo:* ${gpsLink}\n` +
        `⚠️ *Solicito asistencia urgente en esta posición.*`
      );
      window.open(`https://wa.me/?text=${msg}`, '_blank');
    };
  }

  const supportBtn = modalEl.querySelector('#safety-support-btn');
  if (supportBtn) {
    supportBtn.onclick = async () => {
      closeModal();
      const { openDriverDirectSupportChat } = await import('./support-chat.js');
      openDriverDirectSupportChat(latestUser);
    };
  }
}

export function showDriverHelpBottomSheet(user) {
  const isLight = getDriverMapTheme() === 'light';
  const latestUser = getState().user || user || {};

  const existing = document.getElementById('driver-help-bottom-sheet-modal');
  if (existing) existing.remove();

  const backdrop = document.createElement('div');
  backdrop.id = 'driver-help-bottom-sheet-modal';
  backdrop.style.cssText = `
    position: fixed; inset: 0; z-index: 99999;
    background: rgba(0, 0, 0, 0.65);
    backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
    display: flex; flex-direction: column; justify-content: flex-end;
    opacity: 0; transition: opacity 0.25s ease;
  `;

  const sheet = document.createElement('div');
  sheet.style.cssText = `
    width: 100%; max-width: 520px; margin: 0 auto;
    background: ${isLight ? '#ffffff' : '#0f172a'};
    border-top-left-radius: 28px; border-top-right-radius: 28px;
    border-top: 1.5px solid ${isLight ? '#e2e8f0' : 'rgba(255, 255, 255, 0.12)'};
    padding: 14px 20px max(24px, calc(16px + env(safe-area-inset-bottom, 16px))) 20px;
    box-sizing: border-box;
    transform: translateY(100%);
    transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    box-shadow: 0 -10px 40px rgba(0, 0, 0, 0.5);
    color: var(--driver-text-primary);
    max-height: 85vh; overflow-y: auto;
  `;

  sheet.innerHTML = `
    <!-- DRAG HANDLE -->
    <div style="width: 44px; height: 5px; border-radius: 3px; background: ${isLight ? '#cbd5e1' : 'rgba(255,255,255,0.2)'}; margin: 0 auto 16px auto; cursor: pointer;"></div>

    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
      <div style="display: flex; align-items: center; gap: 10px;">
        <div style="width: 40px; height: 40px; border-radius: 12px; background: linear-gradient(135deg, #e11d48, #be123c); color: white; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(225, 29, 72, 0.4);">
          ${icon('helpCircle', 20)}
        </div>
        <div>
          <div style="font-size: 16.5px; font-weight: 900;">Centro de Ayuda Repartidor</div>
          <div style="font-size: 11.5px; color: var(--driver-text-secondary);">Guías rápidas y soporte en vivo</div>
        </div>
      </div>
      <button id="close-help-sheet-btn" aria-label="Cerrar" style="width: 44px; height: 44px; border-radius: 50%; background: var(--driver-fill-subtle); border: none; color: var(--driver-text-label); font-size: 16px; font-weight: 900; cursor: pointer; display: flex; align-items: center; justify-content: center;">
        ✕
      </button>
    </div>

    <!-- QUICK ACTIONS -->
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 18px;">
      <button id="help-sheet-support-chat-btn" style="
        background: ${isLight ? '#fff1f2' : 'rgba(225, 29, 72, 0.15)'};
        border: 1.5px solid ${isLight ? '#fecaca' : 'rgba(225, 29, 72, 0.35)'};
        color: ${isLight ? '#be123c' : '#fb7185'};
        padding: 12px; border-radius: 16px; font-size: 12.5px; font-weight: 900;
        display: flex; flex-direction: column; align-items: center; gap: 6px; cursor: pointer;
      ">
        <span style="display:inline-flex;">${icon('chatBubble', 22)}</span>
        <span>Chat con Soporte</span>
      </button>

      <a href="https://wa.me/5492221415253?text=${encodeURIComponent('Hola Base GoDelivery! 👋 Necesito comunicarme con la base.')}" target="_blank" rel="noopener noreferrer" style="
        background: ${isLight ? '#f0fdf4' : 'rgba(34, 197, 94, 0.15)'};
        border: 1.5px solid ${isLight ? '#bbf7d0' : 'rgba(34, 197, 94, 0.35)'};
        color: ${isLight ? '#15803d' : '#4ade80'};
        padding: 12px; border-radius: 16px; font-size: 12.5px; font-weight: 900;
        display: flex; flex-direction: column; align-items: center; gap: 6px; text-decoration: none; text-align: center;
      ">
        <span style="display:inline-flex;">${icon('smartphone', 22)}</span>
        <span>Llamar a Base (WhatsApp)</span>
      </a>
    </div>

    <!-- FAQ LIST -->
    <div style="display: flex; flex-direction: column; gap: 8px;">
      <div style="font-size: 11.5px; font-weight: 900; color: var(--driver-text-secondary); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px;">
        Preguntas Frecuentes
      </div>

      <details style="background: var(--driver-fill-faint); border: 1px solid var(--driver-border); border-radius: 14px; padding: 12px; cursor: pointer;">
        <summary style="font-size: 13px; font-weight: 800; color: var(--driver-text-primary-soft);">
          <span style="display:inline-flex; vertical-align:middle; margin-right:4px;">${icon('shoppingBag', 13)}</span>¿Cómo realizo un pedido tipo Mandado?
        </summary>
        <div style="font-size: 12px; color: var(--driver-text-label); margin-top: 8px; line-height: 1.45;">
          En los mandados el cliente escribe el comercio o producto libremente. Dirigite al local indicado, realizá la compra y luego deslizá la barra <strong>RETIRADO</strong>. Podés ingresar el valor del ticket de compra para cobrarle exacto al cliente.
        </div>
      </details>

      <details style="background: var(--driver-fill-faint); border: 1px solid var(--driver-border); border-radius: 14px; padding: 12px; cursor: pointer;">
        <summary style="font-size: 13px; font-weight: 800; color: var(--driver-text-primary-soft);">
          <span style="display:inline-flex; vertical-align:middle; margin-right:4px;">${icon('home', 13)}</span>¿Qué hago si el cliente no responde en la puerta?
        </summary>
        <div style="font-size: 12px; color: var(--driver-text-label); margin-top: 8px; line-height: 1.45;">
          Tocá el botón de <strong>Chat</strong> en la barra superior para escribirle. Si pasados 5 minutos no responde, contactá al soporte central.
        </div>
      </details>

      <details style="background: var(--driver-fill-faint); border: 1px solid var(--driver-border); border-radius: 14px; padding: 12px; cursor: pointer;">
        <summary style="font-size: 13px; font-weight: 800; color: var(--driver-text-primary-soft);">
          <span style="display:inline-flex; vertical-align:middle; margin-right:4px;">${icon('dollarSign', 13)}</span>¿Cómo cobrar si el pago es por transferencia?
        </summary>
        <div style="font-size: 12px; color: var(--driver-text-label); margin-top: 8px; line-height: 1.45;">
          El cliente verá tu <strong>Alias</strong> directamente en su pantalla de seguimiento para transferirte el monto exacto. Podés confirmar la acreditación en tu cuenta antes de entregar el paquete.
        </div>
      </details>
    </div>
  `;

  backdrop.appendChild(sheet);
  document.body.appendChild(backdrop);

  requestAnimationFrame(() => {
    backdrop.style.opacity = '1';
    sheet.style.transform = 'translateY(0)';
  });

  const close = () => {
    backdrop.style.opacity = '0';
    sheet.style.transform = 'translateY(100%)';
    setTimeout(() => backdrop.remove(), 250);
  };

  backdrop.onclick = (e) => { if (e.target === backdrop) close(); };
  sheet.querySelector('#close-help-sheet-btn').onclick = close;
  const supportChatBtn = sheet.querySelector('#help-sheet-support-chat-btn');
  if (supportChatBtn) {
    supportChatBtn.onclick = async () => {
      close();
      const { openDriverDirectSupportChat } = await import('./support-chat.js');
      openDriverDirectSupportChat(latestUser);
    };
  }
}

