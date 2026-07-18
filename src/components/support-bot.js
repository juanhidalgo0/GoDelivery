// GoDelivery — Real-time Client Support Chat Component (Connected to Admin Dashboard)
import { getState, subscribe } from '../state.js';
import { db } from '../firebase.js';
import { icon } from '../utils/icons.js';

export function initSupportBot() {
  // Prevent duplicate insertion
  if (document.getElementById('support-bot-container')) return;

  const container = document.createElement('div');
  container.id = 'support-bot-container';
  document.body.appendChild(container);

  // Styling rules for the support chat
  const style = document.createElement('style');
  style.id = 'support-bot-styles';
  style.innerHTML = `
    .support-bot-fab {
      position: fixed;
      bottom: 115px;
      right: 20px;
      width: 58px;
      height: 58px;
      border-radius: 50%;
      background: linear-gradient(135deg, var(--color-primary), #E31B23);
      color: white;
      box-shadow: 0 8px 30px rgba(227, 27, 35, 0.4);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      z-index: 1000;
      transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      border: 3px solid rgba(255,255,255,0.25);
    }
    .support-bot-fab:active {
      transform: scale(0.9);
    }
    .support-bot-fab.open {
      transform: rotate(135deg);
      background: var(--color-surface);
      color: var(--color-text-secondary);
      border-color: var(--color-border);
      box-shadow: 0 8px 25px rgba(0,0,0,0.15);
    }
    
    .support-bot-window {
      position: fixed;
      bottom: 185px;
      right: 20px;
      width: calc(100% - 40px);
      max-width: 380px;
      height: 520px;
      max-height: calc(100vh - 200px);
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: 28px;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.15);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      z-index: 999;
      opacity: 0;
      transform: translateY(20px) scale(0.95);
      pointer-events: none;
      transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .support-bot-window.show {
      opacity: 1;
      transform: translateY(0) scale(1);
      pointer-events: auto;
    }

    .support-bot-message {
      padding: 12px 16px;
      border-radius: 18px;
      max-width: 82%;
      font-size: 13px;
      font-weight: 600;
      line-height: 1.5;
      animation: msgPop 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
      opacity: 0;
      transform: scale(0.9);
      transform-origin: left bottom;
      word-break: break-word;
    }
    .support-bot-message.bot {
      background: var(--color-bg-secondary);
      color: var(--color-text);
      border-bottom-left-radius: 4px;
      align-self: flex-start;
    }
    .support-bot-message.user {
      background: var(--color-primary);
      color: white;
      border-bottom-right-radius: 4px;
      align-self: flex-end;
      transform-origin: right bottom;
    }

    @keyframes msgPop {
      to { opacity: 1; transform: scale(1); }
    }
  `;
  document.head.appendChild(style);

  // Chat window template
  container.innerHTML = `
    <button class="support-bot-fab" id="support-bot-fab-btn">
      <span id="support-bot-icon-container" style="display:flex; align-items:center; justify-content:center;">${icon('chatBubble', 26)}</span>
      <span id="user-support-unread-badge" style="display:none; position:absolute; top:-4px; right:-4px; background:var(--color-primary); color:white; min-width:18px; height:18px; border-radius:50%; border:2px solid white; font-size:10px; font-weight:900; align-items:center; justify-content:center; animation: badgePulse 2s infinite; padding:1px; box-sizing:border-box;">0</span>
    </button>

    <div class="support-bot-window" id="support-bot-window-panel">
      <!-- Chat Header -->
      <div style="background:var(--color-primary); padding:16px 20px; display:flex; align-items:center; gap:12px; color:white; flex-shrink:0; position:relative; overflow:hidden;">
        <div style="position: absolute; top: -10px; right: -10px; width: 50px; height: 50px; background: rgba(255,255,255,0.06); border-radius: 50%; pointer-events: none;"></div>
        <div style="width:36px; height:36px; border-radius:50%; background:rgba(255,255,255,0.2); display:flex; align-items:center; justify-content:center; box-shadow: 0 4px 10px rgba(0,0,0,0.1);">
          ${icon('chat', 20)}
        </div>
        <div>
          <div style="font-weight:900; font-size:14.5px; letter-spacing:-0.01em;" id="user-chat-header-title">Soporte GoDelivery</div>
          <div style="font-size:10px; opacity:0.85; font-weight:700;" id="user-chat-header-subtitle">Chat directo con Administradores</div>
        </div>
        <button id="close-bot-btn" style="background:none; border:none; color:white; margin-left:auto; cursor:pointer; opacity:0.8; padding:4px;">
          ${icon('close', 20)}
        </button>
      </div>

      <!-- Messages Panel -->
      <div id="support-bot-messages" style="flex:1; padding:16px; overflow-y:auto; display:flex; flex-direction:column; gap:12px; background:var(--color-bg);">
        <div style="text-align:center; padding:40px 20px; color:var(--color-text-tertiary); font-weight:600; font-size:13px; line-height:1.6;">
          ¡Hola! Escribí tu consulta o problema a continuación. Un administrador de GoDelivery se conectará de inmediato para ayudarte en tiempo real.
        </div>
      </div>

      <!-- Bottom Chat Area (Dynamic Input vs Closed Banner) -->
      <div id="user-chat-footer-area" style="flex-shrink:0;">
        <div style="display:flex; padding: 10px 14px; background: var(--color-surface); border-top: 1px solid var(--color-border); gap:8px; align-items:center;">
          <input type="text" id="support-bot-input" placeholder="Escribí tu mensaje..." style="flex:1; min-width:0; border: 1.5px solid var(--color-border); border-radius: 14px; padding: 8px 14px; font-size:13px; font-weight:700; outline:none; background:var(--color-bg); color:var(--color-text); transition:border-color 0.2s;" />
          <button id="support-bot-send" style="background:var(--color-primary); color:white; border:none; border-radius:14px; width:40px; height:40px; display:flex; align-items:center; justify-content:center; flex-shrink:0; cursor:pointer; box-shadow:0 4px 12px rgba(var(--color-primary-rgb), 0.2);">
            ${icon('send', 18)}
          </button>
        </div>
      </div>
    </div>
  `;

  const fab = document.getElementById('support-bot-fab-btn');
  const panel = document.getElementById('support-bot-window-panel');
  const closeBtn = document.getElementById('close-bot-btn');
  const messagesBox = document.getElementById('support-bot-messages');
  const footerArea = document.getElementById('user-chat-footer-area');
  const unreadBadge = document.getElementById('user-support-unread-badge');

  const headerTitle = document.getElementById('user-chat-header-title');
  const headerSubtitle = document.getElementById('user-chat-header-subtitle');

  let activeUnsub = null;
  let isOpen = false;
  let commerceCommissionRate = null;
  let currentActiveTicketId = null;

  const fetchCommerceCommission = async (user) => {
    if (!user) return;
    if (user.role === 'comercio' || user.role === 'admin' || user.role === 'super' || user.role === 'soporte') {
      const { doc, getDoc } = await import('firebase/firestore');
      try {
        const snap = await getDoc(doc(db, 'comercios', user.uid));
        if (snap.exists()) {
          const data = snap.data();
          if (data.commissionRate !== undefined && data.commissionRate !== null) {
            commerceCommissionRate = data.commissionRate;
          }
        }
      } catch (e) {
        console.error('Error fetching commerce commission:', e);
      }
    }
  };

  const toggleInputAreaVisibility = (show) => {
    if (show) {
      footerArea.style.display = 'block';
    } else {
      footerArea.style.display = 'none';
    }
  };

  const startRealtimeChat = async (userId) => {
    if (activeUnsub) activeUnsub();

    const user = getState().user;
    await fetchCommerceCommission(user);

    const { collection, query, where, onSnapshot, addDoc, serverTimestamp, doc, updateDoc } = await import('firebase/firestore');
    
    // Listen to ALL support chats for this user
    const q = query(collection(db, 'support_chats'), where('userId', '==', userId));
    
    activeUnsub = onSnapshot(q, (snap) => {
      const renderFAQsAndForm = () => {
        headerTitle.textContent = 'Soporte GoDelivery';
        headerSubtitle.textContent = 'Preguntas Frecuentes y Soporte';

        messagesBox.innerHTML = `
          <div id="faq-view-container">
            ${renderPresetQuestionsChipArea()}
          </div>

          <div style="margin-top: 16px; padding: 16px; background: var(--color-surface); border: 1.5px solid var(--color-border-light); border-radius: 20px; box-shadow: var(--shadow-xs);">
            <h4 style="margin: 0 0 8px 0; font-family: var(--font-display); font-size: 13.5px; font-weight: 850; color: var(--color-text-primary);">Crear Ticket de Soporte</h4>
            <p style="margin: 0 0 12px 0; font-size: 11.5px; color: var(--color-text-secondary); font-weight: 600; line-height: 1.45;">¿No encontrás respuesta en las preguntas frecuentes? Detallá tu consulta aquí abajo para que un administrador te responda.</p>
            
            <textarea id="support-ticket-text" placeholder="Escribí tu consulta detalladamente aquí..." style="width: 100%; height: 80px; border-radius: 12px; border: 1.5px solid var(--color-border); padding: 10px; font-size: 12.5px; font-weight: 700; outline: none; box-sizing: border-box; background: var(--color-bg); color: var(--color-text); resize: none; font-family: var(--font-sans);"></textarea>
            
            <button id="send-support-ticket-btn" class="btn btn-primary btn-block" style="height: 44px; border-radius: 12px; font-size: 13px; font-weight: 900; margin-top: 10px; background: linear-gradient(135deg, var(--color-primary), #E31B23); color:white; border:none; cursor:pointer;">
              ENVIAR TICKET AL SOPORTE
            </button>
          </div>
        `;

        toggleInputAreaVisibility(false);
        attachPresetQuestionListeners();

        const submitBtn = document.getElementById('send-support-ticket-btn');
        const textarea = document.getElementById('support-ticket-text');
        if (submitBtn && textarea) {
          submitBtn.onclick = async () => {
            const textVal = textarea.value.trim();
            if (!textVal) {
              import('../components/toast.js').then(m => m.showToast('Escribí tu consulta antes de enviar', 'warning'));
              return;
            }

            submitBtn.disabled = true;
            textarea.disabled = true;

            try {
              const ticketNum = Math.floor(100000 + Math.random() * 900000);
              const ticketIdStr = `#TK-${ticketNum}`;

              // Create unique ticket document instead of user.uid
              const newTicketRef = await addDoc(collection(db, 'support_chats'), {
                userId: userId,
                userName: user.displayName || 'Usuario',
                email: user.email || '',
                goId: user.goId || '',
                ticketId: ticketIdStr,
                status: 'pending',
                lastMessageText: textVal,
                lastMessageTime: serverTimestamp(),
                unreadByAdmin: true,
                unreadByUser: false,
                messages: [{
                  sender: 'user',
                  text: textVal,
                  timestamp: Date.now()
                }]
              });

              currentActiveTicketId = newTicketRef.id;

              import('../components/toast.js').then(m => m.showToast('¡Ticket de soporte enviado con éxito!', 'success'));
              textarea.value = '';
              submitBtn.disabled = false;
              textarea.disabled = false;
            } catch (err) {
              console.error('Error submitting support ticket:', err);
              import('../components/toast.js').then(m => m.showToast('Error al enviar el ticket', 'error'));
              submitBtn.disabled = false;
              textarea.disabled = false;
            }
          };
        }
      };

      const attachPresetQuestionListeners = () => {
        messagesBox.querySelectorAll('.support-preset-chip').forEach(chip => {
          chip.onclick = () => {
            const text = chip.dataset.msg;
            const qTitle = chip.querySelector('span:first-child').textContent;
            if (!text) return;
            
            const matched = simulatedAIAnswers.find(item => item.match(text));
            const answer = matched ? matched.answer : text;

            const faqContainer = document.getElementById('faq-view-container');
            if (faqContainer) {
              faqContainer.innerHTML = `
                <div style="background:var(--color-bg-secondary); border-radius:18px; padding:14px; border:1px solid var(--color-border-light); animation: msgPop 0.25s ease-in-out forwards; text-align:left;">
                  <h4 style="margin:0 0 8px 0; font-family:var(--font-display); font-size:13.5px; font-weight:850; color:var(--color-text-primary);">${qTitle}</h4>
                  <p style="margin:0; font-size:12px; color:var(--color-text-secondary); line-height:1.5; font-weight:600;">${answer}</p>
                  
                  <button id="btn-back-to-faqs" style="margin-top:12px; height:32px; padding:0 12px; border-radius:8px; border:1.5px solid var(--color-border); background:var(--color-surface); color:var(--color-primary); font-weight:800; font-size:11px; cursor:pointer; display:flex; align-items:center; gap:4px; font-family:var(--font-display);">
                    ${icon('chevronLeft', 12)} Volver a preguntas
                  </button>
                </div>
              `;

              const backBtn = document.getElementById('btn-back-to-faqs');
              if (backBtn) {
                backBtn.onclick = () => {
                  faqContainer.innerHTML = renderPresetQuestionsChipArea();
                  attachPresetQuestionListeners();
                };
              }
            }
          };
        });
      };

      // Find an active support chat (not closed and not the user.uid legacy doc)
      const activeDoc = snap.docs.find(d => d.data().status !== 'closed' && d.id !== userId);

      if (!activeDoc) {
        renderFAQsAndForm();
        unreadBadge.style.display = 'none';
        currentActiveTicketId = null;
        return;
      }

      const activeTicketId = activeDoc.id;
      currentActiveTicketId = activeTicketId;
      const data = activeDoc.data();
      const messages = data.messages || [];

      // Update Header with Ticket ID
      if (data.ticketId) {
        headerTitle.textContent = `Soporte ${data.ticketId}`;
      } else {
        headerTitle.textContent = 'Soporte GoDelivery';
      }

      const isClosed = data.status === 'closed';
      if (isClosed) {
        import('firebase/firestore').then(({ doc: docRef, deleteDoc }) => {
          deleteDoc(docRef(db, 'support_chats', activeTicketId)).catch(() => {});
        });
        currentActiveTicketId = null;
        return;
      }
      
      headerSubtitle.textContent = 'Chat activo en tiempo real ⚡';

      // Update badge if unread and window is closed
      if (data.unreadByUser && !isOpen) {
        let unreadCount = 0;
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].sender === 'admin') {
            unreadCount++;
          } else {
            break;
          }
        }
        if (unreadCount > 0) {
          unreadBadge.textContent = unreadCount;
          unreadBadge.style.display = 'flex';
        } else {
          unreadBadge.style.display = 'none';
        }
      } else {
        unreadBadge.style.display = 'none';
      }

      if (messages.length === 0) {
        renderFAQsAndForm();
      } else {
        // Prepend a nice floating/inline questions button so they can browse questions even with an active or closed ticket
        const backToPresetButtonHTML = `
          <button id="ai-top-questions-btn" style="align-self:center; margin: 4px 0 10px 0; background:var(--color-bg-secondary); border:1.5px solid var(--color-border); border-radius:12px; color:var(--color-primary); font-weight:800; font-size:11px; padding:8px 16px; cursor:pointer; display:flex; align-items:center; gap:6px; transition:all 0.2s; box-shadow:var(--shadow-sm); z-index:10; font-family:var(--font-display);">
            ${icon('chatBubble', 14)} Consultar Preguntas Frecuentes
          </button>
        `;

        messagesBox.innerHTML = backToPresetButtonHTML + messages.map(msg => {
          const isUser = msg.sender === 'user';
          const dateObj = msg.timestamp ? new Date(msg.timestamp) : new Date();
          const timeStr = dateObj.toLocaleTimeString('es-AR', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
          }).toLowerCase();

          const isMine = isUser;
          const ticksHtml = isMine ? (
            !data.unreadByAdmin ? `
              <span class="chat-tick" style="margin-left:4px; display:inline-flex; align-items:center; vertical-align:middle; line-height:1;">
                <svg width="15" height="11" viewBox="0 0 16 11" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M1 5L5 9L15 1.5" stroke="#38bdf8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
                  <path d="M5 5L9 9L19 1.5" stroke="#38bdf8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" transform="translate(-4, 0)"/>
                </svg>
              </span>
            ` : `
              <span class="chat-tick" style="margin-left:4px; display:inline-flex; align-items:center; vertical-align:middle; line-height:1;">
                <svg width="15" height="11" viewBox="0 0 16 11" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M1 5L5 9L15 1.5" stroke="rgba(255,255,255,0.45)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
                  <path d="M5 5L9 9L19 1.5" stroke="rgba(255,255,255,0.45)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" transform="translate(-4, 0)"/>
                </svg>
              </span>
            `
          ) : '';

          return `
            <div class="support-bot-message ${msg.sender === 'user' ? 'user' : 'bot'}" style="${msg.image ? 'padding: 8px 8px 18px 8px;' : 'padding: 10px 14px 18px 14px;'} position:relative; min-width:70px;">
              ${msg.audio ? `
                <div style="display:flex;align-items:center;gap:10px;padding:4px 8px;padding-bottom:10px;">
                  <div style="background:rgba(255,255,255,0.2);border-radius:50%;padding:8px;display:flex;align-items:center;justify-content:center;color:${msg.sender === 'user' ? 'white' : 'var(--color-primary)'};">${icon('mic', 16)}</div>
                  <audio controls src="${msg.audio}" style="height:32px;max-width:180px;"></audio>
                </div>
              ` : msg.image ? `
                <img src="${msg.image}" style="max-width:100%; border-radius:12px; display:block; cursor:pointer; box-shadow:var(--shadow-sm);" onclick="window.open('${msg.image}')" />
                ${msg.text && msg.text !== '📷 Foto enviada' ? `<div style="margin-top:6px; font-weight:600; margin-bottom:10px;">${msg.text}</div>` : ''}
              ` : `<div style="margin-bottom:2px; word-break:break-word; padding-right:16px;">${msg.text}</div>`}
              
              <div style="position:absolute; bottom:4px; right:10px; display:flex; align-items:center; gap:2px; font-size:9.5px; opacity:0.8; font-weight:700; color:${msg.sender === 'user' ? 'rgba(255,255,255,0.75)' : 'var(--color-text-tertiary)'}; font-family:var(--font-display);">
                <span>${timeStr}</span>
                ${ticksHtml}
              </div>
            </div>
          `;
        }).join('');

        // Bind top questions button
        const topBtn = messagesBox.querySelector('#ai-top-questions-btn');
        if (topBtn) {
          topBtn.onclick = () => {
            renderFAQsAndForm();
            messagesBox.scrollTop = 0;
          };
        }

        messagesBox.scrollTop = messagesBox.scrollHeight;
      }

      renderInputArea(!isClosed, data.ticketId);
      toggleInputAreaVisibility(!isClosed);

      // If user has the window open, automatically clear unreadByUser flag and save read timestamp
      if (isOpen && data.unreadByUser) {
        import('firebase/firestore').then(({ serverTimestamp }) => {
          updateDoc(doc(db, 'support_chats', activeTicketId), { 
            unreadByUser: false, 
            userReadAt: serverTimestamp() 
          }).catch(() => {});
        }).catch(() => {
          updateDoc(doc(db, 'support_chats', activeTicketId), { 
            unreadByUser: false, 
            userReadAt: new Date().toISOString() 
          }).catch(() => {});
        });
      }
    }, (err) => console.error('Error in realtime chat support listener:', err));
  };

  const renderPresetQuestionsChipArea = () => {
    const user = getState().user;
    if (!user) return '';

    const { isDelivery, isComercio, isAdmin } = requireRoleCheckers();
    let roleText = 'Cliente';
    let questions = [
      { text: '¿Qué es y cómo se calcula la Tarifa de Servicio de la App?', val: 'Hola, quisiera saber qué es y bajo qué criterio se calcula la Tarifa de Servicio que aparece detallada en mi carrito al hacer un pedido.' },
      { text: '¿Cómo funciona el recargo de envío por lluvia?', val: 'Hola, tengo una duda de cómo funciona y de cuánto es el recargo adicional en el costo de envío cuando está lloviendo.' },
      { text: '¿Cuántos comercios puedo agregar al mismo pedido?', val: 'Hola, ¿cuál es el límite de comercios distintos que puedo agregar al mismo pedido en mi carrito?' },
      { text: 'Tarifa por parada extra en GoFavores', val: 'Hola, ¿cómo se calcula y de cuánto es el adicional por parada extra en un pedido de GoFavor?' }
    ];

    if (isDelivery()) {
      roleText = 'Repartidor';
      questions = [
        { text: 'Duda sobre comisiones y deudas', val: 'Hola soporte, tengo una consulta sobre el cálculo de mis comisiones o la deuda acumulada en la app.' },
        { text: '¿Cómo funcionan los cupones en mis ganancias?', val: 'Hola soporte, ¿cómo impactan los cupones de descuento que usan los clientes en mis ganancias netas de reparto?' },
        { text: 'Problemas de GPS / Seguimiento en mapa', val: 'Hola soporte, tengo inconvenientes con la geolocalización o el mapa de entrega en mi dispositivo.' },
        { text: 'Reportar cliente ausente / Dirección incorrecta', val: 'Hola soporte, estoy en el destino pero el cliente no responde o la dirección es incorrecta.' }
      ];
    } else if (isComercio()) {
      roleText = 'Comercio';
      // Dynamically get commerce commission
      const rate = commerceCommissionRate !== null ? commerceCommissionRate : (getState().commissionRate || 0.10);
      const commissionPct = `${Math.round(rate * 100)}%`;
      
      questions = [
        { text: 'Consultar mi porcentaje de comisión actual', val: `Hola soporte, quisiera consultar mi porcentaje de comisión actual por pedido en la app. En mis registros figura una comisión de: ${commissionPct}. ¿Me podrían confirmar si es la correcta y detallar cómo se liquida?` },
        { text: '¿Cómo confirmo y marco un pedido como Listo?', val: 'Hola soporte, ¿cómo funciona el flujo correcto para recibir un pedido pendiente, confirmarlo, gestionarlo en preparación y marcarlo como listo para retirar?' },
        { text: 'Dudas sobre el retiro de pedidos', val: 'Hola soporte, ¿en qué momento exacto vienen los repartidores a retirar los pedidos que marcamos listos y cómo se les asigna?' },
        { text: 'Gestión de Stock de mis productos', val: 'Hola soporte, ¿cómo puedo pausar, desactivar productos sin stock o modificar productos de forma masiva en mi menú?' }
      ];
    }

    return `
      <div class="support-preset-container" style="display:flex; flex-direction:column; gap:10px; padding:10px; background:var(--color-bg-secondary); border-radius:20px; border:1px solid var(--color-border-light); margin-top:8px; animation: msgPop 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;">
        <div style="font-size:10px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.05em; padding-left:4px; display:flex; align-items:center; gap:6px;">
          ${icon('chat', 11)} <span>Preguntas frecuentes como ${roleText}</span>
        </div>
        <div style="display:flex; flex-direction:column; gap:6px;">
          ${questions.map((q, idx) => `
            <button class="support-preset-chip" data-msg="${q.val}" style="text-align:left; background:var(--surface-color, var(--color-surface)); border:1px solid var(--color-border); border-radius:12px; padding:10px 14px; font-size:12px; font-weight:700; color:var(--color-text-secondary); cursor:pointer; transition:all 0.2s; display:flex; align-items:center; justify-content:space-between; gap:8px;">
              <span>${q.text}</span>
              <span style="color:var(--color-primary); display:flex; align-items:center; transition:transform 0.2s;">${icon('chevronRight', 10)}</span>
            </button>
          `).join('')}
        </div>
      </div>
      <style>
        .support-preset-chip:hover {
          border-color: var(--color-primary);
          color: var(--color-text-primary);
          transform: translateY(-1px);
          box-shadow: var(--shadow-sm);
          background: rgba(var(--color-primary-rgb, 225, 29, 72), 0.02);
        }
        .support-preset-chip:hover span:last-child {
          transform: translateX(3px);
        }
        .support-preset-chip:active {
          transform: translateY(0);
        }
      </style>
    `;
  };

  const requireRoleCheckers = () => {
    // Dynamically retrieve auth state role helpers
    const user = getState().user;
    const isApproved = user?.deliveryStatus === 'approved';
    const hasRole = user?.role === 'delivery';
    const isTest = user?.email === 'test-delivery@godelivery.com';

    return {
      isDelivery: () => !!(isApproved || hasRole || isTest),
      isComercio: () => !!(user?.role === 'comercio' || user?.role === 'admin' || user?.role === 'super' || user?.role === 'soporte')
    };
  };

  const simulatedAIAnswers = [
    {
      match: (t) => {
        const s = t.toLowerCase();
        return s.includes('porcentaje') || s.includes('comisión') || s.includes('comision');
      },
      get answer() {
        const rate = commerceCommissionRate !== null ? commerceCommissionRate : (getState().commissionRate || 0.10);
        const pct = `${Math.round(rate * 100)}%`;
        return `Como comercio asociado, tu comisión actual asignada en GoDelivery es del **${pct}** por pedido. Esta comisión se calcula exclusivamente sobre el subtotal neto de los productos vendidos por cada pedido. Las tarifas de envío y servicio no sufren descuentos, garantizando un reparto transparente.`;
      }
    },
    {
      match: (t) => {
        const s = t.toLowerCase();
        return s.includes('tarifa de servicio') || s.includes('servicio');
      },
      answer: 'La **Tarifa de Servicio** es un cargo variable (generalmente del 1% al 3% sobre el subtotal de tus productos) destinado a cubrir costos tecnológicos de la plataforma, mantenimiento de servidores, actualizaciones de seguridad y el procesamiento de pagos transaccionales. Su objetivo es asegurar que GoDelivery funcione rápido y seguro en todo momento.'
    },
    {
      match: (t) => {
        const s = t.toLowerCase();
        return s.includes('lluvia') || s.includes('climática');
      },
      answer: 'Cuando se detectan condiciones climáticas de lluvia en tu zona, la app activa de forma automática un **recargo por lluvia** (por defecto de **$300 ARS**). Este recargo se suma por completo al costo del envío y se le transfiere al 100% al repartidor asignado, con el objetivo de compensar y recompensar su esfuerzo adicional por realizar la entrega bajo condiciones climáticas adversas.'
    },
    {
      match: (t) => {
        const s = t.toLowerCase();
        return s.includes('comercios') || s.includes('límite') || s.includes('limite');
      },
      answer: 'En GoDelivery podés consolidar compras de múltiples comercios dentro de un mismo carrito. Sin embargo, para garantizar una logística eficiente y que tu comida llegue en perfectas condiciones térmicas, el límite máximo permitido es de **hasta 3 comercios diferentes por pedido**.'
    },
    {
      match: (t) => {
        const s = t.toLowerCase();
        return s.includes('parada extra') || s.includes('paradas');
      },
      answer: 'En la sección de GoFavores (mandados o envíos especiales), podés añadir paradas intermedias de recolección o entrega. Cada **parada extra** tiene un costo adicional fijo que se suma a la distancia recorrida en kilómetros. Este adicional compensa al repartidor por el tiempo extra de espera en cada punto intermedio del recorrido.'
    },
    {
      match: (t) => {
        const s = t.toLowerCase();
        return s.includes('deuda acumulada') || s.includes('deudas');
      },
      answer: 'Como repartidor, la aplicación te cobra una pequeña comisión fija sobre el costo del envío de cada pedido realizado. Si cobrás pedidos en efectivo, ese dinero en efectivo queda en tu poder, acumulando una "deuda de comisiones" con la app. Podés saldar esta deuda mediante transferencia en la sección de **Finanzas** de tu panel de delivery para seguir recibiendo pedidos sin límites.'
    },
    {
      match: (t) => {
        const s = t.toLowerCase();
        return s.includes('cupones') || s.includes('descuento');
      },
      answer: '¡Tus ganancias de reparto están 100% protegidas! Cualquier cupón de descuento o campaña de "Envío Gratis" es costeado en su totalidad por la plataforma de GoDelivery. Dado que el cliente te abonará un monto menor en efectivo, **el descuento del cupón se resta automáticamente de tu deuda de comisiones** con la aplicación al completar la entrega, manteniendo tu ingreso neto real intacto.'
    },
    {
      match: (t) => {
        const s = t.toLowerCase();
        return s.includes('geolocalización') || s.includes('gps') || s.includes('mapa');
      },
      answer: 'Si el GPS no rastrea correctamente tu ubicación, te sugerimos: (1) Verificar que tengas el GPS/Ubicación en modo de "Alta Precisión" en los ajustes de tu celular, (2) Permitir a GoDelivery permisos de ubicación "Siempre activos" o "Mientras la app está en uso", y (3) Recargar la app. Podés presionar el botón de centrado en el mapa para restablecer la vista de tu recorrido.'
    },
    {
      match: (t) => {
        const s = t.toLowerCase();
        return s.includes('no responde') || s.includes('ausente') || s.includes('incorrecta');
      },
      answer: 'Si el cliente no atiende o la dirección destino presenta inconsistencias, te sugerimos abrir el chat directo del pedido con el cliente. Si transcurren más de 10 minutos sin respuesta, comunícate con el soporte general para que cancelemos el pedido de forma segura y se te reintegren los costos correspondientes.'
    },
    {
      match: (t) => {
        const s = t.toLowerCase();
        return s.includes('flujo') || s.includes('confirmarlo') || s.includes('preparación');
      },
      answer: 'El flujo operativo para comercios es muy sencillo: (1) Cuando ingresa un pedido nuevo en tu panel, este aparece en la pestaña de **Pendientes** con una alerta sonora. (2) Debés revisarlo y presionar **Confirmar Pedido** para pasarlo a **Preparación** (se le notificará al cliente). (3) Una vez finalizada la cocción o empaque del producto, presioná **Marcar como Listo** para que el sistema asigne un repartidor disponible y lo retire.'
    },
    {
      match: (t) => {
        const s = t.toLowerCase();
        return s.includes('retirar los pedidos') || s.includes('repartidores a retirar') || s.includes('momento exacto') || s.includes('vienen');
      },
      answer: 'En el instante exacto en que presionás **"Marcar como Listo"** en un pedido, este se publica automáticamente como disponible en la red de todos los repartidores activos que están en línea en tu zona. El primer repartidor en aceptar el lote se dirigirá de inmediato a tu local para retirarlo. Podés ver su nombre, foto e ID de seguimiento en tiempo real.'
    },
    {
      match: (t) => {
        const s = t.toLowerCase();
        return s.includes('stock') || s.includes('pausar') || s.includes('productos');
      },
      answer: 'Podés administrar el inventario de tu menú en tiempo real y sin complicaciones. Desde tu Panel de Comercio, ingresá a la sección de **Productos**. Allí podrás hacer clic en el switch de stock de cualquier producto para pausarlo temporalmente si te quedaste sin ingredientes. También podés editar precios e imágenes al instante.'
    }
  ];

  const attachPresetQuestionListeners = () => {
    messagesBox.querySelectorAll('.support-preset-chip').forEach(chip => {
      chip.onclick = () => {
        const text = chip.dataset.msg;
        if (!text) return;
        
        handleSimulatedAISend(text);
      };
    });
  };

  const handleSimulatedAISend = async (text) => {
    const user = getState().user;
    if (!user) return;

    // Save dynamic preset view back state locally
    const lastActiveMessages = Array.from(messagesBox.querySelectorAll('.support-bot-message')).map(m => ({
      sender: m.classList.contains('user') ? 'user' : 'bot',
      text: m.innerText
    }));

    // 1. Render User Question Locally in UI
    const userMsgHTML = `
      <div class="support-bot-message user">
        ${text}
      </div>
    `;
    
    // Remove instructions/chips during active response preview
    messagesBox.innerHTML = '';
    
    if (lastActiveMessages.length > 0) {
      messagesBox.innerHTML = lastActiveMessages.map(msg => `
        <div class="support-bot-message ${msg.sender === 'user' ? 'user' : 'bot'}">
          ${msg.text}
        </div>
      `).join('');
    }

    messagesBox.insertAdjacentHTML('beforeend', userMsgHTML);
    
    // 2. Render typing simulator
    const typingHTML = `
      <div id="ai-typing-loader" class="support-bot-message bot" style="display:flex; align-items:center; gap:4px; padding: 10px 14px; width:60px;">
        <span class="typing-dot" style="width:5px; height:5px; background:var(--color-text-tertiary); border-radius:50%; animation: typing-bounce 1s infinite;"></span>
        <span class="typing-dot" style="width:5px; height:5px; background:var(--color-text-tertiary); border-radius:50%; animation: typing-bounce 1s infinite; animation-delay:0.2s;"></span>
        <span class="typing-dot" style="width:5px; height:5px; background:var(--color-text-tertiary); border-radius:50%; animation: typing-bounce 1s infinite; animation-delay:0.4s;"></span>
      </div>
      <style>
        @keyframes typing-bounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
      </style>
    `;
    messagesBox.insertAdjacentHTML('beforeend', typingHTML);
    messagesBox.scrollTop = messagesBox.scrollHeight;

    // Simulate AI delay
    setTimeout(() => {
      // Remove typing loader
      document.getElementById('ai-typing-loader')?.remove();

      // Retrieve static answer using matching function
      const matched = simulatedAIAnswers.find(item => item.match(text));
      const answer = matched ? matched.answer : 'Lo siento, no tengo una respuesta exacta para esta pregunta predeterminada.';

      // 3. Render Rich AI Answer locally
      const aiMsgHTML = `
        <div class="support-bot-message bot" style="background:var(--color-bg-secondary); border-radius:18px; border-bottom-left-radius:4px; margin-bottom:4px;">
          <div style="font-size:10px; font-weight:800; color:var(--color-primary); text-transform:uppercase; margin-bottom:4px; display:flex; align-items:center; gap:4px;">
            ${icon('sparkles', 11)} Asistente Inteligente GoDelivery
          </div>
          <div style="line-height:1.4; font-size:12.5px;">${answer}</div>
        </div>
        
        <!-- Back Button to Questions -->
        <button id="ai-back-to-questions-btn" style="align-self:flex-start; background:none; border:none; color:var(--color-primary); font-weight:800; font-size:11.5px; padding:6px 12px; margin-bottom:8px; cursor:pointer; display:flex; align-items:center; gap:6px; transition:all 0.2s;">
          ${icon('chevronLeft', 14)} Volver a Preguntas Frecuentes
        </button>
      `;
      messagesBox.insertAdjacentHTML('beforeend', aiMsgHTML);
      messagesBox.scrollTop = messagesBox.scrollHeight;

      // Bind dynamic back button
      const backBtn = document.getElementById('ai-back-to-questions-btn');
      if (backBtn) {
        backBtn.onclick = () => {
          messagesBox.innerHTML = `
            <div style="text-align:center; padding:32px 16px 16px 16px; color:var(--color-text-tertiary); font-weight:600; font-size:13px; line-height:1.6;">
              ¡Hola! Escribí tu consulta o problema a continuación. Un administrador de GoDelivery se conectará de inmediato para ayudarte en tiempo real.
            </div>
            ${renderPresetQuestionsChipArea()}
          `;
          attachPresetQuestionListeners();
          messagesBox.scrollTop = 0;
        };
      }
    }, 1200);
  };

  const handleSendImage = async (file) => {
    const user = getState().user;
    if (!user || !currentActiveTicketId) return;

    try {
      import('../components/toast.js').then(t => t.showToast('Enviando imagen...', 'info'));
      const { compressImageToBase64 } = await import('../utils/image.js');
      const base64Data = await compressImageToBase64(file, 800, 0.6);

      const { doc, getDoc, updateDoc, arrayUnion, serverTimestamp } = await import('firebase/firestore');
      const chatRef = doc(db, 'support_chats', currentActiveTicketId);
      const chatSnap = await getDoc(chatRef);

      const newMessage = {
        sender: 'user',
        text: '📷 Foto enviada',
        image: base64Data,
        timestamp: Date.now()
      };

      await updateDoc(chatRef, {
        status: 'pending_approval',
        goId: user.goId || chatSnap.data().goId || '',
        lastMessageText: '📷 Foto',
        lastMessageTime: serverTimestamp(),
        unreadByAdmin: true,
        unreadByUser: false,
        messages: arrayUnion(newMessage)
      });
    } catch (err) {
      console.error('Error sending support image:', err);
    }
  };

  const handleSendAudio = async (base64Audio) => {
    const user = getState().user;
    if (!user || !currentActiveTicketId) return;

    try {
      import('../components/toast.js').then(t => t.showToast('Enviando audio...', 'info'));
      const { doc, getDoc, updateDoc, arrayUnion, serverTimestamp } = await import('firebase/firestore');
      const chatRef = doc(db, 'support_chats', currentActiveTicketId);
      const chatSnap = await getDoc(chatRef);

      const newMessage = {
        sender: 'user',
        text: '🎙 Mensaje de voz',
        audio: base64Audio,
        timestamp: Date.now()
      };

      await updateDoc(chatRef, {
        status: 'pending_approval',
        goId: user.goId || chatSnap.data().goId || '',
        lastMessageText: '🎙 Mensaje de voz',
        lastMessageTime: serverTimestamp(),
        unreadByAdmin: true,
        unreadByUser: false,
        messages: arrayUnion(newMessage)
      });
    } catch (err) {
      console.error('Error sending support audio:', err);
    }
  };

  const renderInputArea = (active, ticketId = '') => {
    if (active) {
      footerArea.innerHTML = `
        <div class="chat-input-bar" style="width:100%; box-sizing:border-box; position:relative;">
          <button class="chat-attach-btn" id="support-attach-btn" title="Adjuntar imagen">${icon('camera', 20)}</button>
          <input type="file" id="support-file-gallery" style="display:none" accept="image/*" />
          <input type="file" id="support-file-camera" style="display:none" accept="image/*" capture="environment" />
          <input type="text" id="support-bot-input" class="chat-input" placeholder="Escribí tu mensaje..." autocomplete="off" />
          
          <div id="support-audio-recording-overlay" style="display:none; position:absolute; inset:0; background:var(--color-surface); align-items:center; justify-content:space-between; padding:0 110px 0 16px; border-radius:18px; z-index:50; border:1.5px solid var(--color-border);">
            <div style="display:flex; align-items:center; gap:8px;">
              <div class="recording-dot" style="width: 8px; height: 8px; background: #e11d48; border-radius: 50%; animation: pulse 1s infinite;"></div>
              <span id="support-audio-timer" style="font-weight: 800; font-size: 14px; color:var(--color-text-primary); font-family:var(--font-display);">0:00</span>
            </div>
            <div style="display:flex; align-items:center; gap:4px; animation: slideHint 1.5s infinite; color: var(--color-text-tertiary); font-size: 12px; font-weight: 700;">
              <span style="font-size:14px; margin-right:4px;">‹</span> Desliza para cancelar
            </div>
          </div>

          <button class="chat-mic-btn" id="support-mic-btn" title="Grabar audio" style="color:var(--color-primary); z-index:60; position:relative; touch-action:none;">${icon('mic', 20)}</button>
          <button class="chat-send-btn" id="support-bot-send" style="z-index:60; position:relative;">
            ${icon('send', 18)}
          </button>
        </div>
      `;

      // Re-bind listeners
      const sendBtn = footerArea.querySelector('#support-bot-send');
      const textInput = footerArea.querySelector('#support-bot-input');
      const attachBtn = footerArea.querySelector('#support-attach-btn');
      const fileInputGallery = footerArea.querySelector('#support-file-gallery');
      const fileInputCamera = footerArea.querySelector('#support-file-camera');
      const micBtn = footerArea.querySelector('#support-mic-btn');
      const audioIndicator = footerArea.querySelector('#support-audio-recording-overlay');
      const audioTimer = footerArea.querySelector('#support-audio-timer');

      sendBtn.onclick = handleSendMessage;
      textInput.onkeydown = (e) => {
        if (e.key === 'Enter') handleSendMessage();
      };

      if (attachBtn) {
        attachBtn.onclick = () => {
          import('../components/modal.js').then(m => {
            m.showModal({
              title: 'Enviar imagen',
              content: `
                <div style="padding: 24px 20px; display: flex; flex-direction: column; gap: 16px;">
                  <button id="btn-use-camera-support" style="width: 100%; height: 56px; border-radius: 18px; background: var(--color-primary); color: white; border: none; font-weight: 850; font-size: 15px; display: flex; align-items: center; justify-content: center; gap: 10px; cursor: pointer; box-shadow: 0 8px 20px rgba(var(--color-primary-rgb), 0.25);">
                    ${icon('camera', 20)} Tomar Foto (Cámara)
                  </button>
                  <button id="btn-use-gallery-support" style="width: 100%; height: 56px; border-radius: 18px; background: var(--color-bg-secondary); border: 1.5px solid var(--color-border); color: var(--color-text-primary); font-weight: 850; font-size: 15px; display: flex; align-items: center; justify-content: center; gap: 10px; cursor: pointer;">
                    ${icon('image', 20)} Seleccionar de Galería
                  </button>
                </div>
              `,
              height: 'auto',
              hideHeader: true,
              onOpen: () => {
                const btnCamera = document.getElementById('btn-use-camera-support');
                const btnGallery = document.getElementById('btn-use-gallery-support');
                if (btnCamera) btnCamera.onclick = () => { m.closeModal(); fileInputCamera?.click(); };
                if (btnGallery) btnGallery.onclick = () => { m.closeModal(); fileInputGallery?.click(); };
              }
            });
          });
        };
      }

      if (fileInputGallery) fileInputGallery.onchange = (e) => handleSendImage(e.target.files[0]);
      if (fileInputCamera) fileInputCamera.onchange = (e) => handleSendImage(e.target.files[0]);

      // Audio recording handling
      let mediaRecorder;
      let audioChunks = [];
      let recordStartTime;
      let recordTimer;
      let isRecording = false;
      let startX = 0;
      let isCancelled = false;

      const stopRecording = () => {
        if (isRecording && mediaRecorder && mediaRecorder.state !== 'inactive') {
          mediaRecorder.stop();
        }
      };

      micBtn.addEventListener('dragstart', (e) => e.preventDefault());

      const preventSelect = (e) => e.preventDefault();

      const handlePointerMove = (e) => {
        if (isRecording) {
          const diffX = startX - e.clientX;
          if (diffX > 0) {
            micBtn.style.transform = `scale(1.4) translateX(${-diffX}px)`;
          } else {
            micBtn.style.transform = 'scale(1.4) translateX(0px)';
          }

          if (diffX > 150) {
            isCancelled = true;
            stopRecording();
            import('../components/toast.js').then(m => m.showToast('Grabación cancelada', 'warning'));
          }
        }
      };

      const handlePointerUp = (e) => {
        if (isRecording) {
          stopRecording();
        }
      };

      micBtn.addEventListener('dragstart', (e) => e.preventDefault());

      micBtn.addEventListener('pointerdown', async (e) => {
        e.preventDefault();
        startX = e.clientX;
        isCancelled = false;

        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream);
            audioChunks = [];
            
            mediaRecorder.ondataavailable = ev => {
              if (ev.data.size > 0) audioChunks.push(ev.data);
            };

            mediaRecorder.onstart = () => {
              isRecording = true;
              recordStartTime = Date.now();
              audioIndicator.style.display = 'flex';
              micBtn.style.backgroundColor = 'var(--color-primary)';
              micBtn.style.color = 'white';
              micBtn.style.transform = 'scale(1.4) translateX(0px)';
              micBtn.style.boxShadow = '0 0 15px rgba(225, 29, 72, 0.5)';
              micBtn.style.borderRadius = '50%';
              micBtn.innerHTML = icon('arrowLeft', 20);

              recordTimer = setInterval(() => {
                const elapsed = Math.floor((Date.now() - recordStartTime) / 1000);
                const m = Math.floor(elapsed / 60);
                const s = (elapsed % 60).toString().padStart(2, '0');
                audioTimer.textContent = `${m}:${s} (Deslizá < para cancelar)`;
              }, 1000);

              window.addEventListener('pointermove', handlePointerMove);
              window.addEventListener('pointerup', handlePointerUp);
              window.addEventListener('pointercancel', handlePointerUp);
              window.addEventListener('selectstart', preventSelect);
            };

            mediaRecorder.onstop = async () => {
              isRecording = false;
              clearInterval(recordTimer);
              audioIndicator.style.display = 'none';
              micBtn.style.backgroundColor = '';
              micBtn.style.color = '';
              micBtn.style.transform = '';
              micBtn.style.boxShadow = '';
              micBtn.style.borderRadius = '';
              micBtn.innerHTML = icon('mic', 20);
              
              window.removeEventListener('pointermove', handlePointerMove);
              window.removeEventListener('pointerup', handlePointerUp);
              window.removeEventListener('pointercancel', handlePointerUp);
              window.removeEventListener('selectstart', preventSelect);
              
              stream.getTracks().forEach(track => track.stop());

              if (audioChunks.length > 0 && !isCancelled) {
                const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                const reader = new FileReader();
                reader.readAsDataURL(audioBlob);
                reader.onloadend = () => {
                  handleSendAudio(reader.result);
                };
              }
            };

            mediaRecorder.start();
          } catch (err) {
            console.error("Mic access error:", err);
            import('../components/toast.js').then(m => m.showToast('Permiso de micrófono denegado', 'error'));
          }
        }
      });
    } else {
      footerArea.innerHTML = `
        <div style="background:var(--color-bg-secondary); border-top:1px solid var(--color-border); padding:16px 20px; text-align:center; font-size:12.5px; font-weight:800; color:var(--color-text-secondary); display:flex; flex-direction:column; gap:6px; align-items:center; justify-content:center; width:100%;">
          <div style="display:flex; align-items:center; gap:6px; color:var(--color-text-tertiary);">
            <span style="display:flex; align-items:center; gap:4px;">${icon('lock', 14)} Ticket Finalizado ${ticketId}</span>
          </div>
          <div style="font-size:11px; font-weight:600; opacity:0.7;">Esta consulta ha sido marcada como resuelta por el administrador.</div>
        </div>
      `;
    }
  };

  const handleSendMessage = async () => {
    const user = getState().user;
    if (!user) {
      import('../components/toast.js').then(t => t.showToast('Iniciá sesión para enviar mensajes de soporte', 'warning'));
      return;
    }

    const textInput = footerArea.querySelector('#support-bot-input');
    const sendBtn = footerArea.querySelector('#support-bot-send');
    if (!textInput) return;

    const text = textInput.value.trim();
    if (!text) return;

    textInput.value = '';
    textInput.disabled = true;
    sendBtn.disabled = true;

    try {
      if (!currentActiveTicketId) return;
      const { doc, getDoc, updateDoc, arrayUnion, serverTimestamp } = await import('firebase/firestore');
      const chatRef = doc(db, 'support_chats', currentActiveTicketId);
      const chatSnap = await getDoc(chatRef);

      const newMessage = {
        sender: 'user',
        text: text,
        timestamp: Date.now()
      };

      await updateDoc(chatRef, {
        status: 'pending_approval',
        goId: user.goId || chatSnap.data().goId || '',
        lastMessageText: text,
        lastMessageTime: serverTimestamp(),
        unreadByAdmin: true,
        unreadByUser: false,
        messages: arrayUnion(newMessage)
      });
    } catch (err) {
      console.error('Error sending message:', err);
    } finally {
      if (textInput) {
        textInput.disabled = false;
        textInput.focus();
      }
      if (sendBtn) sendBtn.disabled = false;
    }
  };

  const toggleBot = () => {
    const user = getState().user;
    if (!user) {
      import('../components/toast.js').then(t => t.showToast('Iniciá sesión para acceder al soporte', 'warning'));
      return;
    }

    const iconContainer = document.getElementById('support-bot-icon-container');
    isOpen = !isOpen;
    if (isOpen) {
      fab.classList.add('open');
      if (iconContainer) iconContainer.innerHTML = icon('close', 24);
      panel.classList.add('show');
      unreadBadge.style.display = 'none';

      // Clear unread flag
      if (currentActiveTicketId) {
        import('firebase/firestore').then(({ doc, updateDoc }) => {
          updateDoc(doc(db, 'support_chats', currentActiveTicketId), { unreadByUser: false }).catch(() => {});
        });
      }
    } else {
      fab.classList.remove('open');
      if (iconContainer) iconContainer.innerHTML = icon('chatBubble', 26);
      panel.classList.remove('show');
    }
  };

  fab.onclick = toggleBot;
  closeBtn.onclick = toggleBot;

  // Visibility handler: Visible strictly on Home page ('/')
  const updateVisibility = () => {
    const rawHash = window.location.hash;
    const hash = (rawHash === '' || rawHash === '#/') ? '/' : rawHash.slice(1);
    const hashPath = hash.split('?')[0];

    const fabEl = document.getElementById('support-bot-fab-btn');
    const panelEl = document.getElementById('support-bot-window-panel');

    if (hashPath === '/' || hashPath === '') {
      if (fabEl) fabEl.style.display = 'flex';
    } else {
      if (fabEl) fabEl.style.display = 'none';
      if (panelEl) {
        panelEl.classList.remove('show');
        if (fabEl) {
          fabEl.classList.remove('open');
          const iconContainer = document.getElementById('support-bot-icon-container');
          if (iconContainer) iconContainer.innerHTML = icon('chatBubble', 26);
        }
        isOpen = false;
      }
    }
  };

  window.addEventListener('hashchange', updateVisibility);
  updateVisibility(); // Initial check

  // React to user auth state change dynamically
  subscribe('user', (user) => {
    if (user) {
      startRealtimeChat(user.uid);
    } else {
      if (activeUnsub) {
        activeUnsub();
        activeUnsub = null;
      }
    }
  });

  const user = getState().user;
  if (user) {
    startRealtimeChat(user.uid);
  }
}

export async function openSupportTicketModal(orderId, orderNum) {
  const { showModal, closeModal } = await import('./modal.js');
  const { doc, getDoc, setDoc, updateDoc, onSnapshot, arrayUnion, serverTimestamp } = await import('firebase/firestore');
  const { db } = await import('../firebase.js');
  const user = getState().user;
  if (!user) {
    import('./toast.js').then(t => t.showToast('Iniciá sesión para acceder a soporte', 'warning'));
    return;
  }

  const isFullTicketId = orderId && (orderId.toString().startsWith('ticket_') || orderId.toString().length >= 20);
  const ticketDocId = isFullTicketId ? orderId : `ticket_${orderId}`;
  const displayTicketNum = orderNum || (isFullTicketId ? (orderId.toString().includes('_') ? orderId.split('_')[1] : orderId.slice(0, 6).toUpperCase()) : orderId);
  const chatRef = doc(db, 'support_chats', ticketDocId);
  
  // Chat document creation is deferred until the first message is sent to prevent empty tickets.

  // 2. Create the HTML layout for the fullscreen modal
  const contentEl = document.createElement('div');
  contentEl.className = 'ticket-chat-viewport';
  contentEl.innerHTML = `
    <!-- Header -->
    <div class="ticket-chat-header" style="background:var(--color-primary); padding:16px 20px; display:flex; align-items:center; gap:12px; color:white; flex-shrink:0; position:relative; box-shadow:var(--shadow-md);">
      <button id="ticket-chat-back-btn" style="background:none; border:none; color:white; cursor:pointer; padding:6px; display:flex; align-items:center; justify-content:center;">
        ${icon('chevronLeft', 24)}
      </button>
      <div style="text-align:left;">
        <div style="font-weight:900; font-size:15px; letter-spacing:-0.01em;">Soporte Técnico</div>
        <div style="font-size:11px; opacity:0.85; font-weight:700;" id="ticket-chat-header-num">Cargando ticket...</div>
      </div>
      <div style="margin-left:auto; font-size:10px; font-weight:900; background:rgba(255,255,255,0.2); padding:4px 8px; border-radius:6px; color:white;">
        ACTIVO
      </div>
    </div>

    <!-- Messages Container -->
    <div id="ticket-messages-container" style="flex:1; padding:20px; overflow-y:auto; display:flex; flex-direction:column; gap:14px; background:var(--color-bg); min-height: 250px;">
      <div style="text-align:center; padding:30px; color:var(--color-text-tertiary); font-size:13px; font-weight:600;">
        Cargando conversación con soporte...
      </div>
    </div>

    <!-- Footer Input Area -->
    <div id="ticket-chat-footer" style="padding:12px 16px; background:var(--color-surface); border-top:1px solid var(--color-border); display:flex; gap:8px; align-items:center; flex-shrink:0;">
      <input type="text" id="ticket-chat-input" placeholder="Escribí tu mensaje aquí..." style="flex:1; min-width:0; border:1.5px solid var(--color-border); border-radius:16px; padding:12px 16px; font-size:13.5px; font-weight:700; outline:none; background:var(--color-bg); color:var(--color-text); transition:border-color 0.2s;" />
      <button id="ticket-chat-send-btn" style="background:var(--color-primary); color:white; border:none; border-radius:16px; width:48px; height:48px; display:flex; align-items:center; justify-content:center; flex-shrink:0; cursor:pointer; box-shadow:0 4px 12px rgba(var(--color-primary-rgb), 0.2);">
        ${icon('send', 20)}
      </button>
    </div>

    <style>
      .ticket-chat-viewport {
        height: 100%;
        display: flex;
        flex-direction: column;
        background: var(--color-bg);
        overflow: hidden;
      }
      .ticket-chat-msg {
        padding: 12px 16px;
        border-radius: 18px;
        max-width: 80%;
        font-size: 13.5px;
        font-weight: 600;
        line-height: 1.5;
        word-break: break-word;
      }
      .ticket-chat-msg.bot {
        background: var(--color-bg-secondary);
        color: var(--color-text);
        border-bottom-left-radius: 4px;
        align-self: flex-start;
      }
      .ticket-chat-msg.user {
        background: var(--color-primary);
        color: white;
        border-bottom-right-radius: 4px;
        align-self: flex-end;
      }
      .ticket-chat-msg.admin {
        background: #3b82f6;
        color: white;
        border-bottom-left-radius: 4px;
        align-self: flex-start;
      }
    </style>
  `;

  // 3. Show fullscreen modal
  showModal({
    title: '',
    content: contentEl,
    hideHeader: true,
    fullscreen: true,
    onOpen: () => {
      const messagesBox = document.getElementById('ticket-messages-container');
      const input = document.getElementById('ticket-chat-input');
      const sendBtn = document.getElementById('ticket-chat-send-btn');
      const backBtn = document.getElementById('ticket-chat-back-btn');

      backBtn.onclick = () => {
        unsub();
        closeModal();
      };

      // Realtime listener for chat messages
      const unsub = onSnapshot(chatRef, (snap) => {
        if (!snap.exists()) {
          const headerNumEl = document.getElementById('ticket-chat-header-num');
          if (headerNumEl) {
            headerNumEl.textContent = `Ticket #TK-${displayTicketNum}`;
          }
          messagesBox.innerHTML = `
            <div style="text-align:center; padding:40px 20px; color:var(--color-text-tertiary); font-weight:600; font-size:13px; line-height:1.6; display:flex; flex-direction:column; align-items:center; gap:10px;">
              <span style="font-size:24px;">💬</span>
              <span>Escribí tu consulta a continuación para iniciar el chat con soporte técnico.</span>
            </div>
          `;
          return;
        }
        const data = snap.data();
        const messages = data.messages || [];

        const headerNumEl = document.getElementById('ticket-chat-header-num');
        if (headerNumEl) {
          const tId = data.ticketId || (data.activeOrderNum ? `#TK-${data.activeOrderNum}` : `#TK-${displayTicketNum}`);
          headerNumEl.textContent = tId.startsWith('#') ? `Ticket ${tId}` : `Ticket #${tId}`;
        }

        if (messages.length === 0) {
          messagesBox.innerHTML = `
            <div style="text-align:center; padding:40px 20px; color:var(--color-text-tertiary); font-weight:600; font-size:13px; line-height:1.6; display:flex; flex-direction:column; align-items:center; gap:10px;">
              <span style="font-size:24px;">💬</span>
              <span>Ticket de soporte iniciado. Escribí tu consulta a continuación y te responderemos a la brevedad.</span>
            </div>
          `;
          return;
        }

        // Render messages
        messagesBox.innerHTML = messages.map(msg => {
          let typeClass = 'bot';
          if (msg.sender === 'user') typeClass = 'user';
          else if (msg.sender === 'admin') typeClass = 'admin';

          const dateObj = msg.timestamp ? new Date(msg.timestamp) : new Date();
          const timeStr = dateObj.toLocaleTimeString('es-AR', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
          }).toLowerCase();

          const isMine = typeClass === 'user';
          const ticksHtml = isMine ? (
            !data.unreadByAdmin ? `
              <span class="chat-tick" style="margin-left:4px; display:inline-flex; align-items:center; vertical-align:middle; line-height:1;">
                <svg width="15" height="11" viewBox="0 0 16 11" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M1 5L5 9L15 1.5" stroke="#38bdf8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
                  <path d="M5 5L9 9L19 1.5" stroke="#38bdf8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" transform="translate(-4, 0)"/>
                </svg>
              </span>
            ` : `
              <span class="chat-tick" style="margin-left:4px; display:inline-flex; align-items:center; vertical-align:middle; line-height:1;">
                <svg width="15" height="11" viewBox="0 0 16 11" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M1 5L5 9L15 1.5" stroke="rgba(255,255,255,0.45)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
                  <path d="M5 5L9 9L19 1.5" stroke="rgba(255,255,255,0.45)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" transform="translate(-4, 0)"/>
                </svg>
              </span>
            `
          ) : '';

          return `
            <div class="ticket-chat-msg ${typeClass}" style="margin-bottom: 8px; position:relative; padding-bottom:18px; min-width:70px;">
              ${msg.audio ? `
                <div style="display:flex;align-items:center;gap:10px;padding:4px 8px;padding-bottom:10px;">
                  <div style="background:rgba(255,255,255,0.2);border-radius:50%;padding:8px;display:flex;align-items:center;justify-content:center;color:${typeClass === 'user' ? 'white' : 'var(--color-primary)'};">${icon('mic', 16)}</div>
                  <audio controls src="${msg.audio}" style="height:32px;max-width:180px;"></audio>
                </div>
              ` : msg.image ? `
                <img src="${msg.image}" style="max-width:100%; border-radius:12px; display:block; cursor:pointer; box-shadow:var(--shadow-sm);" onclick="window.open('${msg.image}')" />
                ${msg.text && msg.text !== '📷 Foto enviada' ? `<div style="margin-top:6px; font-weight:600; margin-bottom:10px;">${msg.text}</div>` : ''}
              ` : `<div style="margin-bottom:2px; word-break:break-word; padding-right:16px;">${msg.text}</div>`}
              
              <div style="position:absolute; bottom:4px; right:10px; display:flex; align-items:center; gap:2px; font-size:9.5px; opacity:0.8; font-weight:700; color:${typeClass === 'user' ? 'rgba(255,255,255,0.75)' : 'var(--color-text-tertiary)'};">
                <span>${timeStr}</span>
                ${ticksHtml}
              </div>
            </div>
          `;
        }).join('');

        // Auto scroll to bottom
        setTimeout(() => {
          messagesBox.scrollTop = messagesBox.scrollHeight;
        }, 100);
      });

      // Send handler
      const sendMessage = async () => {
        const text = input.value.trim();
        if (!text) return;

        input.value = '';
        input.disabled = true;
        sendBtn.disabled = true;

        try {
          const docSnap = await getDoc(chatRef);
          const newMessage = {
            sender: 'user',
            text: text,
            timestamp: Date.now()
          };

          if (!docSnap.exists()) {
            // First message! Create support chat document.
            await setDoc(chatRef, {
              userId: user.uid,
              userRole: 'driver',
              userName: `${user.displayName || 'Repartidor'} (Pedido #${displayTicketNum})`,
              email: user.email || '',
              ticketId: `#TK-${displayTicketNum}`,
              status: 'pending_approval',
              lastMessageText: text,
              lastMessageTime: serverTimestamp(),
              unreadByAdmin: true,
              unreadByUser: false,
              activeOrderId: orderId,
              activeOrderNum: displayTicketNum,
              messages: [newMessage]
            });

            // Write notifications to all admin users
            try {
              const { getDocs, query, collection, where, addDoc } = await import('firebase/firestore');
              const adminsSnap = await getDocs(query(collection(db, 'users'), where('role', '==', 'admin')));
              
              const notifPromises = [];
              adminsSnap.forEach(adminDoc => {
                notifPromises.push(
                  addDoc(collection(db, 'users', adminDoc.id, 'notifications'), {
                    title: 'Nuevo Ticket de Soporte',
                    body: `El repartidor ${user.displayName || 'Repartidor'} inició un chat por el Pedido #${displayTicketNum}: "${text.slice(0, 60)}"`,
                    createdAt: serverTimestamp(),
                    type: 'support_ticket',
                    status: 'unread',
                    clickable: true,
                    url: `#/admin/support-chats?ticketId=${ticketDocId}`,
                    data: {
                      chatId: ticketDocId,
                      orderId: orderId
                    }
                  })
                );
              });
              await Promise.all(notifPromises);
            } catch (errNotif) {
              console.error('[SupportBot] Failed to dispatch admin notifications:', errNotif);
            }
          } else {
            // Existing chat, append message.
            await updateDoc(chatRef, {
              status: 'pending_approval',
              lastMessageText: text,
              lastMessageTime: serverTimestamp(),
              unreadByAdmin: true,
              unreadByUser: false,
              messages: arrayUnion(newMessage)
            });
          }
        } catch (err) {
          console.error('Error sending support message:', err);
        } finally {
          input.disabled = false;
          input.focus();
          sendBtn.disabled = false;
        }
      };

      sendBtn.onclick = sendMessage;
      input.onkeydown = (e) => {
        if (e.key === 'Enter') sendMessage();
      };
    }
  });
}
