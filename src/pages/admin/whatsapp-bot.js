// GoDelivery — WhatsApp Bot Admin Control Panel (3 Tabs)
import { getState } from '../../state.js';
import { db } from '../../firebase.js';
import { collection, query, where, onSnapshot, doc, getDoc, updateDoc, orderBy } from 'firebase/firestore';
import { icon } from '../../utils/icons.js';
import { showToast } from '../../components/toast.js';

let activeTab = 'mandados'; // 'mandados' | 'comercios' | 'soporte'
let unsubOrders = null;
let unsubSupport = null;

export async function renderAdminWhatsAppBot(content) {
  if (!content) content = document.getElementById('app-content');
  if (!content) return;

  const isNative = !!window.Capacitor;
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isIosDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const topPadding = isNative ? 'var(--status-bar-height, 24px)' : ((isIosDevice && isStandalone) ? 'calc(34px + env(safe-area-inset-top, 0px))' : 'env(safe-area-inset-top, 0px)');

  content.innerHTML = `
    <div class="admin-page page-enter" style="display: flex; flex-direction: column; height: 100%; width: 100%; background: var(--color-bg); overflow: hidden; position: relative;">
      <!-- Header -->
      <div style="background: linear-gradient(135deg, #25D366 0%, #128C7E 100%); padding: ${topPadding} 0 0 0; position: relative; overflow: hidden; border-bottom-left-radius: 28px; border-bottom-right-radius: 28px; box-shadow: 0 8px 32px rgba(37, 211, 102, 0.25); z-index: 100; flex-shrink: 0;">
        <div style="height: 56px; padding: 0 20px; display: flex; align-items: center; justify-content: space-between; position: relative; z-index: 2; width: 100%; box-sizing: border-box;">
          <div style="display:flex; align-items:center; gap:12px;">
            <button id="wsp-back-btn" style="background:rgba(255,255,255,0.2); border:none; color:white; border-radius:12px; padding:6px; cursor:pointer; display:flex; align-items:center; justify-content:center;">
              ${icon('chevronLeft', 20)}
            </button>
            <span style="font-weight: 900; font-size: 19px; color: white; font-family: var(--font-display); letter-spacing: -0.02em; display:flex; align-items:center; gap:8px;">
              ${icon('whatsapp', 20, '', '#FFF')} Panel Bot WhatsApp
            </span>
          </div>
        </div>

        <!-- 3 Tabs Navigation Bar -->
        <div style="display:flex; gap:6px; padding: 0 16px 14px; width:100%; box-sizing:border-box; overflow-x:auto; scrollbar-width:none;">
          <button class="wsp-tab-btn ${activeTab === 'mandados' ? 'active' : ''}" data-tab="mandados" style="flex:1; height:40px; border-radius:14px; border:none; font-weight:850; font-size:12px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px; transition:all 0.2s; white-space:nowrap; ${activeTab === 'mandados' ? 'background:white; color:#128C7E; box-shadow:0 4px 12px rgba(0,0,0,0.15);' : 'background:rgba(255,255,255,0.2); color:white;'}">
            ${icon('star', 14)} Mandados
          </button>
          <button class="wsp-tab-btn ${activeTab === 'comercios' ? 'active' : ''}" data-tab="comercios" style="flex:1; height:40px; border-radius:14px; border:none; font-weight:850; font-size:12px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px; transition:all 0.2s; white-space:nowrap; ${activeTab === 'comercios' ? 'background:white; color:#128C7E; box-shadow:0 4px 12px rgba(0,0,0,0.15);' : 'background:rgba(255,255,255,0.2); color:white;'}">
            ${icon('store', 14)} Comercios
          </button>
          <button class="wsp-tab-btn ${activeTab === 'soporte' ? 'active' : ''}" data-tab="soporte" style="flex:1; height:40px; border-radius:14px; border:none; font-weight:850; font-size:12px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px; transition:all 0.2s; white-space:nowrap; ${activeTab === 'soporte' ? 'background:white; color:#128C7E; box-shadow:0 4px 12px rgba(0,0,0,0.15);' : 'background:rgba(255,255,255,0.2); color:white;'}">
            ${icon('headset', 14)} Humano / Soporte
          </button>
        </div>
      </div>

      <!-- Main Content Container -->
      <div id="wsp-admin-content" style="flex:1; overflow-y:auto; padding: 20px 20px calc(40px + env(safe-area-inset-bottom, 0px)); display:flex; flex-direction:column; gap:14px; background:var(--color-bg);">
        <div style="text-align:center; padding:60px 20px; opacity:0.6;">
          <div class="spinner-mini" style="margin: 0 auto 12px;"></div>
          <span>Cargando datos del bot...</span>
        </div>
      </div>
    </div>
  `;

  // Attach tab switch handlers
  content.querySelectorAll('.wsp-tab-btn').forEach(btn => {
    btn.onclick = () => {
      activeTab = btn.dataset.tab;
      renderAdminWhatsAppBot(content);
    };
  });

  const backBtn = content.querySelector('#wsp-back-btn');
  if (backBtn) {
    backBtn.onclick = () => { window.location.hash = '#/admin'; };
  }

  const container = content.querySelector('#wsp-admin-content');
  startListeners(container);

  return {
    cleanup: () => {
      if (unsubOrders) unsubOrders();
      if (unsubSupport) unsubSupport();
    }
  };
}

function startListeners(container) {
  if (unsubOrders) unsubOrders();
  if (unsubSupport) unsubSupport();

  if (activeTab === 'mandados' || activeTab === 'comercios') {
    const q = query(
      collection(db, 'orders'),
      where('source', '==', 'whatsapp_bot')
    );

    unsubOrders = onSnapshot(q, (snap) => {
      const allWspOrders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      
      let filtered = [];
      if (activeTab === 'mandados') {
        filtered = allWspOrders.filter(o => o.isFavor === true || o.favorType);
      } else {
        filtered = allWspOrders.filter(o => !o.isFavor && !o.favorType);
      }

      // Sort newest first
      filtered.sort((a, b) => {
        const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : new Date(a.createdAt || 0).getTime();
        const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : new Date(b.createdAt || 0).getTime();
        return timeB - timeA;
      });

      renderOrdersList(container, filtered);
    }, err => {
      console.error('Error fetching WhatsApp orders:', err);
      container.innerHTML = `<div style="text-align:center; padding:40px; color:var(--color-error);">Error al cargar pedidos de WhatsApp</div>`;
    });
  } else if (activeTab === 'soporte') {
    const qSupport = query(
      collection(db, 'support_chats')
    );

    unsubSupport = onSnapshot(qSupport, (snap) => {
      const supportChats = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(c => {
          // Strictly require WhatsApp Bot origin or phone-based user ID
          const isWspSource = c.source === 'whatsapp_bot' || c.isWhatsAppBot === true;
          const isPhoneId = c.userId && /^\d{8,15}$/.test(String(c.userId));
          const hasUserPhone = c.userPhone && /^\d{8,15}$/.test(String(c.userPhone).replace(/\D/g, ''));
          return (isWspSource || isPhoneId || hasUserPhone) && (c.humanRequested === true || c.status === 'pending');
        });
      renderSupportList(container, supportChats);
    }, err => {
      console.error('Error fetching support chats:', err);
      container.innerHTML = `<div style="text-align:center; padding:40px; color:var(--color-error);">Error al cargar derivaciones de WhatsApp</div>`;
    });
  }
}

function renderOrdersList(container, orders) {
  if (!container) return;

  if (orders.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding:60px 20px; opacity:0.5;">
        ${icon('whatsapp', 48, '', '#25D366')}
        <p style="font-weight:900; font-size:16px; margin-top:16px;">Sin pedidos por WhatsApp</p>
        <p style="font-size:12px;">Los pedidos ingresados mediante el bot aparecerán aquí.</p>
      </div>
    `;
    return;
  }

  let html = '';
  orders.forEach(o => {
    const isCompleted = o.status === 'completed' || o.status === 'delivered';
    const isCancelled = o.status === 'cancelled';

    let badgeColor = '#3b82f6';
    let badgeText = 'Pendiente';
    if (o.status === 'ready') { badgeColor = '#f59e0b'; badgeText = 'Listo p/ Retiro'; }
    else if (o.status === 'on_way') { badgeColor = '#8b5cf6'; badgeText = 'En Camino'; }
    else if (isCompleted) { badgeColor = '#10b981'; badgeText = 'Entregado'; }
    else if (isCancelled) { badgeColor = '#ef4444'; badgeText = 'Cancelado'; }

    const formattedTotal = `$${(o.total || 0).toLocaleString('es-AR')}`;

    html += `
      <div style="background:var(--color-surface); border-radius:20px; padding:16px; border:1.5px solid var(--color-border-light); display:flex; flex-direction:column; gap:10px; box-shadow:var(--shadow-sm); opacity:${isCompleted || isCancelled ? '0.75' : '1'};">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-weight:900; font-size:15px; color:var(--color-text-primary);">Pedido #${o.orderId || o.id.slice(0,6)}</span>
            <span style="background:${badgeColor}; color:white; padding:2px 8px; border-radius:6px; font-size:10px; font-weight:900; text-transform:uppercase;">${badgeText}</span>
          </div>
          <span style="font-size:16px; font-weight:900; color:var(--color-primary);">${formattedTotal}</span>
        </div>

        <div style="font-size:13px; color:var(--color-text-secondary); font-weight:600;">
          <strong>Origen / Comercio:</strong> ${o.isFavor ? (o.details || o.description || 'Mandado') : (o.comercioName || 'Comercio')}
        </div>
        <div style="font-size:13px; color:var(--color-text-secondary); font-weight:600;">
          <strong>Cliente / Teléfono:</strong> ${o.userName || 'Cliente'} (${o.userPhone || 'WhatsApp'})
        </div>
        <div style="font-size:13px; color:var(--color-text-secondary); font-weight:600;">
          <strong>Dirección Entrega:</strong> ${o.userAddress || o.dropoffAddress || 'Magdalena'}
        </div>

        <div style="display:flex; gap:8px; margin-top:6px; border-top:1px dashed var(--color-border-light); padding-top:10px;">
          ${o.userPhone ? `
            <button class="btn-wsp-contact" data-phone="${o.userPhone}" style="flex:1; height:38px; border-radius:12px; background:#25D366; color:white; border:none; font-weight:850; font-size:12px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px;">
              ${icon('whatsapp', 14, '', '#FFF')} Contactar por WhatsApp
            </button>
          ` : ''}
          <button class="btn-wsp-chat-modal" data-order-id="${o.id}" data-order-num="${o.orderId || ''}" data-user-name="${o.userName || 'Cliente'}" style="flex:1; height:38px; border-radius:12px; background:var(--color-bg-secondary); border:1px solid var(--color-border-light); color:var(--color-text-primary); font-weight:850; font-size:12px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px;">
            ${icon('chatBubble', 14)} Abrir Chat App
          </button>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;

  container.querySelectorAll('.btn-wsp-contact').forEach(btn => {
    btn.onclick = () => {
      const clean = (btn.dataset.phone || '').replace(/\D/g, '');
      const full = clean.startsWith('54') ? clean : `549${clean}`;
      window.open(`https://wa.me/${full}`, '_blank');
    };
  });

  container.querySelectorAll('.btn-wsp-chat-modal').forEach(btn => {
    btn.onclick = async () => {
      const { openChat } = await import('../../components/chat.js');
      openChat({
        orderId: btn.dataset.orderId,
        type: 'client-delivery',
        otherName: btn.dataset.userName,
        orderNum: btn.dataset.orderNum,
        isAudit: true
      });
    };
  });
}

function renderSupportList(container, chats) {
  if (!container) return;

  if (chats.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding:60px 20px; opacity:0.5;">
        ${icon('whatsapp', 48, '', '#25D366')}
        <p style="font-weight:900; font-size:16px; margin-top:16px;">Sin derivaciones de WhatsApp</p>
        <p style="font-size:12px;">Cuando un usuario solicite hablar con un humano por WhatsApp, aparecerá aquí con el botón directo a su chat.</p>
      </div>
    `;
    return;
  }

  let html = '';
  chats.forEach(c => {
    const rawPhone = String(c.userPhone || c.userId || c.phone || '');
    const cleanPhone = rawPhone.replace(/\D/g, '');
    const isUnread = c.unreadByAdmin === true;

    html += `
      <div style="background:var(--color-surface); border-radius:20px; padding:16px; border:1.5px solid ${isUnread ? '#25D366' : 'var(--color-border-light)'}; display:flex; align-items:center; justify-content:space-between; gap:12px; box-shadow:var(--shadow-sm);">
        <div style="display:flex; align-items:center; gap:12px; flex:1; min-width:0;">
          <div style="width:44px; height:44px; border-radius:14px; background:linear-gradient(135deg, #25D366, #128C7E); color:white; display:flex; align-items:center; justify-content:center; font-weight:900; flex-shrink:0;">
            ${icon('whatsapp', 22, '', '#FFF')}
          </div>
          <div style="flex:1; min-width:0;">
            <div style="font-weight:850; font-size:14.5px; color:var(--color-text-primary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
              ${c.userName || cleanPhone || 'Usuario de WhatsApp'}
            </div>
            <div style="font-size:12px; color:var(--color-text-secondary); font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin-top:2px;">
              ${c.lastMessage || 'Solicitó atención humana por WhatsApp'}
            </div>
            <div style="font-size:10.5px; color:#25D366; font-weight:800; margin-top:3px;">
              📱 ${cleanPhone ? `+${cleanPhone}` : 'WhatsApp'}
            </div>
          </div>
        </div>
        <button class="btn-open-wsp-direct" data-phone="${cleanPhone}" style="height:40px; padding:0 14px; border-radius:12px; background:#25D366; color:white; border:none; font-weight:900; font-size:12px; cursor:pointer; flex-shrink:0; display:flex; align-items:center; gap:6px; box-shadow:0 4px 12px rgba(37,211,102,0.25);">
          ${icon('whatsapp', 16, '', '#FFF')} Abrir WhatsApp
        </button>
      </div>
    `;
  });

  container.innerHTML = html;

  container.querySelectorAll('.btn-open-wsp-direct').forEach(btn => {
    btn.onclick = () => {
      const raw = btn.dataset.phone || '';
      const clean = raw.replace(/\D/g, '');
      const full = clean.startsWith('54') ? clean : `549${clean}`;
      window.open(`https://wa.me/${full}`, '_blank');
    };
  });
}
