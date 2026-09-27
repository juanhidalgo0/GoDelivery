// Driver safety and help bottom-sheet modals for the driver panel.
// Extracted from delivery-panel.js so this code is only fetched/parsed when the
// driver actually opens one of these, instead of on every panel load.
import { getState } from '../../state.js';
import { icon } from '../../utils/icons.js';
import { openDriverSheet, sheetRow, sheetTone } from './driver-sheet.js';

export async function showDriverSafetyModal(user) {
  const latestUser = getState().user || user || {};
  const driverName = latestUser.displayName || latestUser.name || 'Repartidor GoDelivery';

  const getGpsShareUrl = () => {
    const pos = window.lastRiderPos;
    if (pos && pos.lat && pos.lng) {
      return `https://maps.google.com/?q=${pos.lat},${pos.lng}`;
    }
    return 'https://maps.google.com/?q=-35.0815,-57.5147';
  };

  const callPill = (tone) => {
    const t = sheetTone(tone);
    return `<span style="display:flex; align-items:center; gap:4px; padding:6px 10px; border-radius:10px; background:${t.bg}; color:${t.fg}; font-size:12px; font-weight:800; flex-shrink:0;">${icon('phone', 13)} Llamar</span>`;
  };

  const { sheet, close } = openDriverSheet({
    id: 'driver-safety-sheet',
    iconName: 'shield',
    tone: 'red',
    title: 'Seguridad',
    subtitle: 'Asistencia inmediata · Magdalena 24/7',
    body: `
      <a href="tel:911" class="dsheet-row" style="background:linear-gradient(135deg, #ef4444 0%, #b91c1c 100%); border-color:transparent; color:#fff; padding:14px; box-shadow:0 8px 22px rgba(239,68,68,0.3);">
        <div class="dsheet-tile" style="background:rgba(255,255,255,0.18); color:#fff;">${icon('alertTriangle', 20)}</div>
        <div style="flex:1; min-width:0;">
          <div class="dsheet-row-title">Llamar al 911</div>
          <div class="dsheet-row-sub" style="color:rgba(255,255,255,0.85);">Emergencias policiales</div>
        </div>
        <span style="display:flex;">${icon('phone', 20)}</span>
      </a>
      ${sheetRow({ tag: 'a', href: 'tel:107', iconName: 'activity', tone: 'green', title: 'SAME · 107', subtitle: 'Ambulancias y urgencias médicas', trailing: callPill('green') })}

      <div class="dsheet-label">Contactos locales</div>
      ${sheetRow({ tag: 'a', href: 'tel:02221452413', iconName: 'shield', tone: 'slate', title: 'Comisaría Magdalena', subtitle: '(02221) 45-2413', trailing: callPill('slate') })}
      ${sheetRow({ tag: 'a', href: 'tel:02221453388', iconName: 'activity', tone: 'slate', title: 'Hospital Magdalena', subtitle: '(02221) 45-3388', trailing: callPill('slate') })}

      <div class="dsheet-label">Asistencia</div>
      ${sheetRow({ id: 'safety-share-gps-btn', iconName: 'mapPin', tone: 'green', title: 'Compartir mi ubicación', subtitle: 'Enviar alerta con GPS por WhatsApp' })}
      ${sheetRow({ id: 'safety-support-btn', iconName: 'headset', tone: 'sky', title: 'Chat con Soporte GoDelivery', subtitle: 'Hablá con la base ahora' })}
    `,
  });

  sheet.querySelector('#safety-share-gps-btn').onclick = () => {
    const gpsLink = getGpsShareUrl();
    const msg = encodeURIComponent(
      `🚨 *EMERGENCIA REPARTIDOR GODELIVERY*\n` +
      `👤 *Repartidor:* ${driverName}\n` +
      `📍 *Mi Ubicación GPS en Vivo:* ${gpsLink}\n` +
      `⚠️ *Solicito asistencia urgente en esta posición.*`
    );
    window.open(`https://wa.me/?text=${msg}`, '_blank');
  };

  sheet.querySelector('#safety-support-btn').onclick = async () => {
    close();
    const { openDriverDirectSupportChat } = await import('./support-chat.js');
    openDriverDirectSupportChat(latestUser);
  };
}

export function showDriverHelpBottomSheet(user) {
  const latestUser = getState().user || user || {};
  const faq = (iconName, q, a) => `
    <details class="dsheet-faq">
      <summary>
        <span style="display:flex; color:var(--driver-text-secondary);">${icon(iconName, 18)}</span>
        <span style="flex:1;">${q}</span>
        <span class="dsheet-chev">${icon('chevronRight', 16)}</span>
      </summary>
      <div class="dsheet-faq-body">${a}</div>
    </details>`;

  const { sheet, close } = openDriverSheet({
    id: 'driver-help-bottom-sheet-modal',
    iconName: 'helpCircle',
    tone: 'amber',
    title: 'Centro de ayuda',
    subtitle: 'Guías rápidas y soporte en vivo',
    body: `
      ${sheetRow({ id: 'help-sheet-support-chat-btn', iconName: 'chatBubble', tone: 'sky', title: 'Chat con Soporte', subtitle: 'Respuesta dentro de la app' })}
      ${sheetRow({ tag: 'a', href: `https://wa.me/5492221415253?text=${encodeURIComponent('Hola Base GoDelivery! 👋 Necesito comunicarme con la base.')}`, attrs: 'target="_blank" rel="noopener noreferrer"', iconName: 'smartphone', tone: 'green', title: 'Contactar a la base', subtitle: 'Por WhatsApp' })}

      <div class="dsheet-label">Preguntas frecuentes</div>
      ${faq('shoppingBag', '¿Cómo realizo un pedido tipo Mandado?', 'En los mandados el cliente escribe el comercio o producto libremente. Dirigite al local indicado, realizá la compra y luego deslizá la barra <strong>RETIRADO</strong>. Podés ingresar el valor del ticket para cobrarle exacto al cliente.')}
      ${faq('home', '¿Qué hago si el cliente no responde en la puerta?', 'Tocá el botón de <strong>Chat</strong> para escribirle. Si pasados 5 minutos no responde, contactá al soporte central.')}
      ${faq('dollarSign', '¿Cómo cobrar si el pago es por transferencia?', 'El cliente ve tu <strong>Alias</strong> en su pantalla de seguimiento para transferirte el monto exacto. Confirmá la acreditación antes de entregar.')}
    `,
  });

  sheet.querySelector('#help-sheet-support-chat-btn').onclick = async () => {
    close();
    const { openDriverDirectSupportChat } = await import('./support-chat.js');
    openDriverDirectSupportChat(latestUser);
  };
}
