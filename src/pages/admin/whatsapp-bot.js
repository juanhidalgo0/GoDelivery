// GoDelivery — WhatsApp Bot Admin Control Panel (3 Tabs)
import { getState } from '../../state.js';
import { db } from '../../firebase.js';
import { collection, query, where, onSnapshot, doc, getDoc, updateDoc, setDoc, orderBy, limit, serverTimestamp } from 'firebase/firestore';
import { escapeHtml } from '../../utils/escape.js';
import { icon } from '../../utils/icons.js';
import { showToast } from '../../components/toast.js';

let activeTab = 'mandados'; // 'mandados' | 'comercios' | 'soporte'
let unsubOrders = null;
let unsubSupport = null;
let unsubChats = null;
let unsubUsage = null;
let unsubConfig = null;

export async function renderAdminWhatsAppBot(content) {
  if (!content) content = document.getElementById('app-content');
  if (!content) return;

  const isNative = !!window.Capacitor;
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isIosDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const topPadding = isNative ? 'var(--status-bar-height, 24px)' : ((isIosDevice && isStandalone) ? 'calc(34px + max(var(--safe-area-inset-top, 0px), env(safe-area-inset-top, 0px)))' : 'max(var(--safe-area-inset-top, 0px), env(safe-area-inset-top, 0px))');

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
          <button class="wsp-tab-btn ${activeTab === 'charlas' ? 'active' : ''}" data-tab="charlas" style="flex:1; height:40px; border-radius:14px; border:none; font-weight:850; font-size:12px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px; transition:all 0.2s; white-space:nowrap; ${activeTab === 'charlas' ? 'background:white; color:#128C7E; box-shadow:0 4px 12px rgba(0,0,0,0.15);' : 'background:rgba(255,255,255,0.2); color:white;'}">
            ${icon('chat', 14)} Charlas
          </button>
          <button class="wsp-tab-btn ${activeTab === 'ajustes' ? 'active' : ''}" data-tab="ajustes" style="flex:1; height:40px; border-radius:14px; border:none; font-weight:850; font-size:12px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px; transition:all 0.2s; white-space:nowrap; ${activeTab === 'ajustes' ? 'background:white; color:#128C7E; box-shadow:0 4px 12px rgba(0,0,0,0.15);' : 'background:rgba(255,255,255,0.2); color:white;'}">
            ⚙️ Ajustes
          </button>
        </div>

        <!-- Cupo gratis de Meta: 1.000 mensajes del bot por mes; desde el 1.001 se cobran -->
        <div id="wsp-usage" style="margin: 0 16px 14px; padding: 10px 14px; border-radius: 14px; background: rgba(255,255,255,0.18); color: white; font-size: 12px; font-weight: 700;">
          <div style="display:flex; justify-content:space-between; gap:8px;">
            <span id="wsp-usage-label">Mensajes del mes: …</span>
            <span id="wsp-usage-left" style="opacity:0.9;"></span>
          </div>
          <div style="height:6px; border-radius:3px; background:rgba(255,255,255,0.25); margin-top:8px; overflow:hidden;">
            <div id="wsp-usage-bar" style="height:100%; width:0%; background:white; border-radius:3px; transition:width 0.3s;"></div>
          </div>
        </div>
      </div>

      <!-- Main Content Container -->
      <div id="wsp-admin-content" style="flex:1; overflow-y:auto; padding: 20px 20px calc(40px + max(var(--safe-area-inset-bottom, 0px), env(safe-area-inset-bottom, 0px))); display:flex; flex-direction:column; gap:14px; background:var(--color-bg);">
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
  watchUsage(content);

  return {
    cleanup: () => {
      if (unsubOrders) unsubOrders();
      if (unsubSupport) unsubSupport();
      if (unsubChats) unsubChats();
      if (unsubUsage) { unsubUsage(); unsubUsage = null; }
      if (unsubConfig) { unsubConfig(); unsubConfig = null; }
    }
  };
}

// Mensajes que mandó el bot este mes (wa_usage/{AAAA-MM}, hora argentina) contra el cupo gratis
function watchUsage(content) {
  if (unsubUsage) unsubUsage();
  const month = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 7);
  const monthName = new Date(`${month}-15T12:00:00Z`).toLocaleDateString('es-AR', { month: 'long' });
  unsubUsage = onSnapshot(doc(db, 'wa_usage', month), (snap) => {
    const d = snap.exists() ? snap.data() : {};
    const sent = Number(d.sent) || 0;
    const free = Number(d.free) || 1000;
    const label = content.querySelector('#wsp-usage-label');
    const left = content.querySelector('#wsp-usage-left');
    const bar = content.querySelector('#wsp-usage-bar');
    if (!label || !left || !bar) return;
    label.textContent = `Mensajes de ${monthName}: ${sent.toLocaleString('es-AR')} de ${free.toLocaleString('es-AR')} gratis`;
    left.textContent = sent >= free ? 'Cupo gratis agotado' : `Quedan ${(free - sent).toLocaleString('es-AR')}`;
    bar.style.width = `${Math.min(100, (sent / free) * 100)}%`;
    bar.style.background = sent >= free * 0.9 ? '#fecaca' : 'white';
  }, () => {});
}

function startListeners(container) {
  if (unsubOrders) unsubOrders();
  if (unsubSupport) unsubSupport();
  if (unsubChats) { unsubChats(); unsubChats = null; }
  if (unsubConfig) { unsubConfig(); unsubConfig = null; }

  // Ajustes: número vinculado, gasto contra el tope y cómo contesta el bot
  if (activeTab === 'ajustes') {
    import('./whatsapp-bot-config.js').then(async ({ renderBotConfig }) => {
      // Si ya se cambió de pestaña mientras cargaba, no se pisa la otra
      const stop = await renderBotConfig(container, () => activeTab === 'ajustes' && container.isConnected);
      if (activeTab === 'ajustes' && container.isConnected) unsubConfig = stop;
      else stop();
    });
    return;
  }

  // Charlas: las últimas conversaciones del bot (wa_sessions.log) y tomar el control de una
  if (activeTab === 'charlas') {
    const q = query(collection(db, 'wa_sessions'), orderBy('updatedAtMs', 'desc'), limit(40));
    unsubChats = onSnapshot(q, (snap) => {
      renderChatsList(container, snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, err => {
      console.error('Error fetching bot chats:', err);
      container.innerHTML = `<div style="text-align:center; padding:40px; color:var(--color-error);">Error al cargar las charlas del bot</div>`;
    });
    return;
  }

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

const STEP_LABEL = {
  quick: 'Contando el pedido', idle: 'En el menú', support: '🙋 Con una persona', confirm: 'Viendo el resumen', c_store: 'Eligiendo comercio', c_items: 'Armando la lista',
  c_parsed: 'Revisando lo que entendió el bot', details: 'Contando el pedido', pickup: 'Dirección de retiro', delivery: 'Dirección de entrega',
  notes: 'Datos para encontrarlo', pay: 'Forma de pago', k_pick: 'Eligiendo comercio', k_search: 'Buscando comercio', k_waiting: 'Esperando precio del comercio', k_quoted: 'Decidiendo con el precio',
};

function renderChatsList(container, chats) {
  if (!container) return;
  if (!chats.length) {
    container.innerHTML = `<div style="text-align:center; padding:60px 20px; opacity:0.5;">Todavía no hay charlas con el bot.</div>`;
    return;
  }
  const ago = (ms) => {
    const m = Math.round((Date.now() - (ms || 0)) / 60000);
    return m < 1 ? 'recién' : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} d`;
  };
  container.innerHTML = chats.map((c) => {
    const log = Array.isArray(c.log) ? c.log.slice(-8) : [];
    const human = c.step === 'support';
    return `
      <div style="background:var(--color-surface); border:1px solid var(--color-border-light); border-radius:18px; padding:14px 16px; display:flex; flex-direction:column; gap:10px;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
          <div style="min-width:0;">
            <div style="font-weight:900; font-size:14px; color:var(--color-text-primary);">${escapeHtml(c.lastName || 'Cliente')} <span style="font-weight:700; color:var(--color-text-tertiary); font-size:12px;">+${escapeHtml(c.id)}</span></div>
            <div style="font-size:12px; color:${human ? '#d97706' : 'var(--color-text-secondary)'}; font-weight:700; margin-top:2px;">${escapeHtml(STEP_LABEL[c.step] || c.step || '')} · ${ago(c.updatedAtMs)}</div>
          </div>
          ${human
            ? `<button class="wsp-chat-bot" data-id="${escapeHtml(c.id)}" style="height:36px; padding:0 12px; border-radius:12px; border:1px solid var(--color-border); background:var(--color-bg); font-weight:800; font-size:12px; cursor:pointer; white-space:nowrap;">🤖 Devolver al bot</button>`
            : `<button class="wsp-chat-human" data-id="${escapeHtml(c.id)}" data-name="${escapeHtml(c.lastName || '')}" style="height:36px; padding:0 12px; border-radius:12px; border:none; background:#25D366; color:white; font-weight:800; font-size:12px; cursor:pointer; white-space:nowrap;">🙋 Atender yo</button>`}
        </div>
        ${log.length ? `<div style="display:flex; flex-direction:column; gap:6px; background:var(--color-bg); border-radius:14px; padding:10px;">
          ${log.map((m) => `<div style="align-self:${m.dir === 'in' ? 'flex-start' : 'flex-end'}; max-width:85%; background:${m.dir === 'in' ? 'var(--color-surface)' : 'rgba(37,211,102,0.12)'}; border-radius:12px; padding:7px 10px; font-size:12.5px; line-height:1.4; white-space:pre-wrap; color:var(--color-text-primary);">${escapeHtml(m.text || '')}</div>`).join('')}
        </div>` : ''}
      </div>`;
  }).join('');

  container.querySelectorAll('.wsp-chat-human').forEach((b) => {
    b.onclick = async () => {
      const id = b.dataset.id;
      try {
        // Igual que "Hablar con alguien": lo que escriba va al panel de Soporte y se contesta desde ahí
        await setDoc(doc(db, 'support_chats', id), {
          userId: id, userName: b.dataset.name || 'Cliente WhatsApp', userPhone: id,
          source: 'whatsapp_bot', isWhatsAppBot: true, humanRequested: true, status: 'pending', updatedAt: serverTimestamp(),
        }, { merge: true });
        await updateDoc(doc(db, 'wa_sessions', id), { step: 'support', data: {}, humanTakeoverAt: Date.now() });
        showToast('Listo: lo que escriba el cliente va a Humano / Soporte', 'success');
      } catch (err) {
        console.error(err);
        showToast('No se pudo tomar la charla', 'error');
      }
    };
  });
  container.querySelectorAll('.wsp-chat-bot').forEach((b) => {
    b.onclick = async () => {
      try {
        await updateDoc(doc(db, 'wa_sessions', b.dataset.id), { step: 'idle', data: {}, humanTakeoverAt: 0 });
        showToast('El bot vuelve a atender esta charla', 'success');
      } catch (err) {
        console.error(err);
        showToast('No se pudo devolver al bot', 'error');
      }
    };
  });
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
