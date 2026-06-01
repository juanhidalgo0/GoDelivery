// GoDelivery — In-App Chat Component (Real-Time via Firestore)
import { db } from '../firebase.js';
import { collection, doc, setDoc, addDoc, getDoc, onSnapshot, query, orderBy, serverTimestamp, updateDoc } from 'firebase/firestore';
import { getState } from '../state.js';
import { showModal } from './modal.js';
import { icon } from '../utils/icons.js';

let isChatOpening = false;

/**
 * Opens a chat modal for a given order.
 */
export async function openChat({ orderId, type, otherName, orderNum, senderDisplayName }) {
  if (isChatOpening) return;
  isChatOpening = true;

  const user = getState().user;
  if (!user) {
    isChatOpening = false;
    return;
  }

  const chatId = `${orderId}_${type}`;
  const chatRef = doc(db, 'chats', chatId);
  const messagesRef = collection(chatRef, 'messages');

  // Build chat UI shell INSTANTLY
  const chatContainer = document.createElement('div');
  chatContainer.className = 'chat-container';
  chatContainer.innerHTML = `
    <div class="chat-header-bar">
      <div class="chat-avatar">
        ${type === 'client-commerce' ? icon('store', 20) : icon('bike', 20)}
      </div>
      <div class="chat-header-info">
        <div class="chat-header-name">${otherName}</div>
        <div class="chat-header-order">Pedido #${orderNum || '---'}</div>
      </div>
      <div id="chat-status-indicator-${chatId}"></div>
    </div>
    <div class="chat-messages" id="chat-messages-${chatId}">
      <div class="chat-loading" style="padding: 100px 0;">
        <div class="loader-dots"><span></span><span></span><span></span></div>
      </div>
    </div>
    <div id="chat-typing-indicator-${chatId}" class="chat-typing-wrapper" style="display:none;"></div>
    <div id="chat-footer-area-${chatId}">
       <div class="chat-loading-mini" style="text-align:center; padding:10px; opacity:0.5; font-size:10px;">Conectando...</div>
    </div>
  `;

  const modalInstance = showModal({
    title: '',
    content: chatContainer,
    hideHeader: true,
    fullSwipe: false,
    height: '85dvh',
    onClose: () => {
      isChatOpening = false;
    }
  });

  // References to DOM
  const messagesContainer = document.getElementById(`chat-messages-${chatId}`);
  if (!messagesContainer) return;

  // Real-time messages listener
  const q = query(messagesRef, orderBy('timestamp', 'asc'));
  let isInitialLoad = true;
  const unsub = onSnapshot(q, (snap) => {
    const messages = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Play sound for incoming message
    if (!isInitialLoad && snap.docChanges().length > 0) {
      snap.docChanges().forEach(change => {
        if (change.type === 'added') {
          const msg = change.doc.data();
          if (msg.senderId !== user.uid) {
            import('../utils/audio-manager.js').then(m => {
              m.AudioManager.playSynthMessageReceive();
            });
          }
        }
      });
    }
    isInitialLoad = false;

    renderMessages(messagesContainer, messages, user.uid, { chatId, orderId, chatType: type });

    // Mark unread messages as read
    snap.docs.forEach(d => {
      const msg = d.data();
      if (msg.senderId !== user.uid && !msg.read) {
        updateDoc(d.ref, { read: true }).catch(() => { });
      }
    });
  });

  // Background Tasks (Status & Init)
  let orderUnsub = () => { };
  let chatDocUnsub = () => { };
  (async () => {
    let isReadOnly = false;
    try {
      // 1. Get current order status
      const orderSnap = await getDoc(doc(db, 'orders', orderId));
      if (orderSnap.exists()) {
        const orderStatus = orderSnap.data().status;
        isReadOnly = orderStatus === 'completed' || orderStatus === 'cancelled';
      }

      // 2. Ensure chat document exists
      await setDoc(chatRef, {
        orderId,
        type,
        participants: [user.uid],
        lastActivityAt: serverTimestamp(),
      }, { merge: true });

      // Update UI with footer and status
      const statusIndicator = document.getElementById(`chat-status-indicator-${chatId}`);
      if (statusIndicator && isReadOnly) {
        statusIndicator.innerHTML = `<div class="chat-status-badge">${icon('lock', 12)} Finalizado</div>`;
      }

      const footerArea = document.getElementById(`chat-footer-area-${chatId}`);
      if (footerArea) {
        if (isReadOnly) {
          footerArea.innerHTML = `
            <div class="chat-closed-bar">
              ${icon('lock', 16)}
              <span>Este chat ha finalizado</span>
            </div>
          `;
        } else {
          const emojiCategories = {
            'Caritas': ['😊','😂','🤣','😍','😒','😭','😘','🥰','😎','🤩','🤔','🤨','🙄','😏','😴','🤤','😋','😛','😜','🤪','😇','🥳','🥺','😱','😨','😰','😥','😓','😩','😫','😤','😡','😠','🤬','🤢','🤮','🤧','🥵','🥶','🥴','😵','🤯','🤠','🤡','🥳','🤫','🤭','🧐','🤓','😈','👿','👹','👺','💀','👻','👽','🤖','💩','😺','😸','😹','😻','😼','😽','🙀','😿','😾'],
            'Gesto': ['👋','🤚','🖐️','✋','🖖','👌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','✍️','💅','🤳','💪','🦾','🦵','🦿','🦶','👣','👂','🦻','👃','🧠','🦷','🦴','👀','👁️','👅','👄','💋'],
            'Entrega': ['🛵','🚚','🚛','🚲','🏎️','🏍️','📍','🏁','⛽','🚦','🚧','🗺️','📦','🎁','🏠','🏢','🏦','🏪','🛒','👜','🛍️','💰','💵','💳','🧾','⏰','⏳','⏱️','🔋','📶','📱','📞','💬'],
            'Comida': ['🍕','🍔','🍟','🌭','🥪','🌮','🌯','🍳','🥘','🍲','🥣','🥗','🍿','🍱','🍘','🍙','🍚','🍛','🍜','🍝','🍠','🍢','🍣','🍤','🍥','🥮','🍡','🥟','🥠','🍦','🍧','🍨','🍩','🍪','🎂','🍰','🧁','🥧','🍫','🍬','🍭','🍮','🍯','🍼','🥛','☕','🍵','🥤','🍶','🍺','🍻','🍷','🍸','🍹','🥃','🧉','🥂']
          };

          footerArea.innerHTML = `
            <div id="emoji-picker-${chatId}" class="chat-emoji-picker-v2" style="display:none;">
              <div class="emoji-picker-header">
                ${Object.keys(emojiCategories).map(cat => `<button class="emoji-cat-btn" data-cat="${cat}">${cat}</button>`).join('')}
              </div>
              <div class="emoji-scroll-area">
                ${Object.entries(emojiCategories).map(([name, list]) => `
                  <div class="emoji-category-section" id="cat-${name}">
                    <div class="emoji-category-title">${name}</div>
                    <div class="emoji-grid-v2">
                      ${list.map(e => `<span class="emoji-item-v2">${e}</span>`).join('')}
                    </div>
                  </div>
                `).join('')}
              </div>
            </div>
            <!-- Quick Reply Pills -->
            <div class="chat-quick-replies" id="quick-replies-${chatId}">
              <button class="quick-pill-btn">¡Ya bajo!</button>
              <button class="quick-pill-btn">Dejalo en la puerta, gracias</button>
              <button class="quick-pill-btn">¿Por dónde venís?</button>
              <button class="quick-pill-btn">¡Perfecto, muchas gracias!</button>
            </div>
            <div class="chat-input-bar">
              <button class="chat-emoji-btn" id="emoji-btn-${chatId}">${icon('smile', 22)}</button>
              <button class="chat-attach-btn" id="chat-attach-${chatId}" title="Adjuntar comprobante">${icon('camera', 22)}</button>
              <input type="file" id="chat-file-${chatId}" style="display:none" accept="image/*" />
              <input type="text" id="chat-input-${chatId}" class="chat-input" placeholder="Escribí un mensaje..." autocomplete="off" />
              <button class="chat-send-btn" id="chat-send-${chatId}">${icon('send', 20)}</button>
            </div>
          `;
          setupInputListeners(chatId, messagesRef, user, chatRef, senderDisplayName);
        }
      }

      // 3. Listen for order status changes to auto-lock the chat
      if (!isReadOnly) {
        orderUnsub = onSnapshot(doc(db, 'orders', orderId), (snap) => {
          if (!snap.exists()) return;
          const newStatus = snap.data().status;
          if (newStatus === 'completed' || newStatus === 'cancelled') {
            const footerArea = document.getElementById(`chat-footer-area-${chatId}`);
            if (footerArea) {
              footerArea.innerHTML = `
                <div class="chat-closed-bar">
                  ${icon('lock', 16)}
                  <span>Este chat ha finalizado</span>
                </div>
              `;
            }
          }
        });
      }

      // Listen for typing status
      chatDocUnsub = onSnapshot(chatRef, (snap) => {
        if (!snap.exists()) return;
        const data = snap.data();
        const typing = data.typing || {};
        let otherIsTyping = false;
        Object.entries(typing).forEach(([uid, isTyping]) => {
          if (uid !== user.uid && isTyping) {
            otherIsTyping = true;
          }
        });
        showTypingIndicator(chatId, otherIsTyping, otherName);
      });
    } catch (e) {
      console.error('Chat background init error:', e);
    }
  })();

  // Cleanup on modal close
  if (modalInstance) {
    const origClose = modalInstance.close;
    modalInstance.close = () => {
      unsub();
      orderUnsub();
      chatDocUnsub();
      updateTypingStatus(chatRef, user.uid, false);
      isChatOpening = false;
      origClose();
    };
  }

  // Lightbox Implementation
  window.openLightbox = (url) => {
    const img = document.createElement('img');
    img.src = url;
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'contain';
    img.style.background = 'black';
    
    showModal({
      title: '',
      content: img,
      fullscreen: true,
      hideHeader: true
    });
  };

  // Delegated listener for Lightbox
  messagesContainer.addEventListener('click', (e) => {
    const imgContainer = e.target.closest('.chat-image-container');
    if (imgContainer && imgContainer.dataset.url) {
      window.openLightbox(imgContainer.dataset.url);
    }
  });
}

function setupInputListeners(chatId, messagesRef, user, chatRef, senderDisplayName) {
  const input = document.getElementById(`chat-input-${chatId}`);
  const sendBtn = document.getElementById(`chat-send-${chatId}`);
  const fileInput = document.getElementById(`chat-file-${chatId}`);
  const attachBtn = document.getElementById(`chat-attach-${chatId}`);

  const emojiBtn = document.getElementById(`emoji-btn-${chatId}`);
  const emojiPicker = document.getElementById(`emoji-picker-${chatId}`);

  if (!input || !sendBtn) return;

  // Emoji Handlers
  emojiBtn?.addEventListener('click', () => {
    const isHidden = emojiPicker.style.display === 'none';
    emojiPicker.style.display = isHidden ? 'flex' : 'none';
    emojiBtn.style.color = isHidden ? 'var(--color-primary)' : '';
  });

  emojiPicker?.querySelectorAll('.emoji-item-v2').forEach(item => {
    item.addEventListener('click', () => {
      input.value += item.textContent;
      input.focus();
    });
  });

  emojiPicker?.querySelectorAll('.emoji-cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const cat = btn.dataset.cat;
      const section = emojiPicker.querySelector(`#cat-${cat}`);
      section?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  // Styles for the new picker and chat upgrades
  if (!document.getElementById('chat-v2-styles')) {
    const s = document.createElement('style');
    s.id = 'chat-v2-styles';
    s.textContent = `
      .chat-emoji-picker-v2 { position: absolute; bottom: 125px; left: 16px; right: 16px; height: 320px; background: var(--glass-bg); backdrop-filter: var(--glass-blur); border-radius: 24px; border: 1px solid var(--glass-border); box-shadow: var(--shadow-lg); display: flex; flex-direction: column; z-index: 1000; animation: emoji-slide-up 0.3s cubic-bezier(0.4, 0, 0.2, 1); overflow: hidden; }
      .emoji-picker-header { display: flex; gap: 8px; padding: 12px; overflow-x: auto; scrollbar-width: none; border-bottom: 1px solid var(--color-border-light); background: rgba(255,255,255,0.2); }
      .emoji-picker-header::-webkit-scrollbar { display: none; }
      .emoji-cat-btn { background: var(--color-surface); border: 1px solid var(--color-border-light); padding: 6px 14px; border-radius: 100px; font-size: 11px; font-weight: 800; color: var(--color-text-secondary); cursor: pointer; white-space: nowrap; }
      .emoji-scroll-area { flex: 1; overflow-y: auto; padding: 16px; scroll-padding-top: 16px; }
      .emoji-category-title { font-size: 10px; font-weight: 900; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 12px; }
      .emoji-grid-v2 { display: grid; grid-template-columns: repeat(8, 1fr); gap: 8px; margin-bottom: 24px; }
      .emoji-item-v2 { font-size: 24px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: transform 0.2s; user-select: none; }
      .emoji-item-v2:active { transform: scale(1.4); }
      
      @keyframes emoji-slide-up { from { opacity: 0; transform: translateY(20px) scale(0.95); } to { opacity: 1; transform: translateY(0) scale(1); } }

      .chat-quick-replies {
        display: flex;
        gap: 8px;
        padding: 10px 16px;
        overflow-x: auto;
        scrollbar-width: none;
        background: var(--color-surface);
        border-top: 1px solid var(--color-border-light);
      }
      .chat-quick-replies::-webkit-scrollbar { display: none; }
      .quick-pill-btn {
        background: var(--color-bg-secondary);
        border: 1px solid var(--color-border-light);
        padding: 8px 14px;
        border-radius: 100px;
        font-size: 11.5px;
        font-weight: 750;
        color: var(--color-text-secondary);
        cursor: pointer;
        white-space: nowrap;
        transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
      }
      .quick-pill-btn:hover {
        background: var(--color-primary);
        color: white;
        border-color: var(--color-primary);
        transform: translateY(-2px);
      }
      .quick-pill-btn:active {
        transform: scale(0.95);
      }

      .chat-typing-wrapper {
        padding: 8px 16px;
        background: var(--color-surface);
        border-top: 1px solid var(--color-border-light);
      }
      .typing-bubble {
        display: flex;
        align-items: center;
        gap: 8px;
        background: var(--color-bg-secondary);
        padding: 8px 14px;
        border-radius: 18px 18px 18px 4px;
        width: fit-content;
        animation: typing-fade-in 0.25s ease-out;
      }
      .typing-text {
        font-size: 11px;
        font-weight: 700;
        color: var(--color-text-secondary);
      }
      .typing-dots {
        display: flex;
        gap: 3px;
        align-items: center;
      }
      .typing-dots span {
        width: 5px;
        height: 5px;
        background: var(--color-primary);
        border-radius: 50%;
        animation: typing-bounce 1.4s infinite ease-in-out both;
      }
      .typing-dots span:nth-child(1) { animation-delay: -0.32s; }
      .typing-dots span:nth-child(2) { animation-delay: -0.16s; }
      
      @keyframes typing-bounce {
        0%, 80%, 100% { transform: scale(0); opacity: 0.3; }
        40% { transform: scale(1); opacity: 1; }
      }
      @keyframes typing-fade-in {
        from { opacity: 0; transform: translateY(5px); }
        to { opacity: 1; transform: translateY(0); }
      }
    `;
    document.head.appendChild(s);
  }

  // Auto-focus
  setTimeout(() => input.focus(), 400);

  const displayName = senderDisplayName || user.displayName || 'Usuario';

  attachBtn?.addEventListener('click', () => fileInput.click());

  fileInput?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const { ref, uploadBytes, getDownloadURL } = await import('firebase/storage');
    const { storage } = await import('../firebase.js');

    import('../utils/audio-manager.js').then(m => {
      m.AudioManager.playSynthMessageSend();
    });

    const docRef = await addDoc(messagesRef, {
      senderId: user.uid,
      senderName: displayName,
      text: 'Subiendo imagen...',
      type: 'image',
      status: 'uploading',
      timestamp: serverTimestamp(),
      read: false,
    });

    try {
      const fileRef = ref(storage, `chats/${chatId}/${Date.now()}_${file.name}`);
      await uploadBytes(fileRef, file);
      const url = await getDownloadURL(fileRef);

      await updateDoc(docRef, {
        text: '',
        imageUrl: url,
        status: 'ready',
      });

      await updateDoc(chatRef, {
        lastMessage: '📷 Imagen',
        lastMessageAt: serverTimestamp(),
      });
    } catch (err) {
      console.error('Upload error:', err);
      await updateDoc(docRef, { text: 'Error al subir imagen', status: 'error' });
    }
  });

  // Set up Quick Reply Pills
  const quickRepliesContainer = document.getElementById(`quick-replies-${chatId}`);
  quickRepliesContainer?.querySelectorAll('.quick-pill-btn').forEach(pill => {
    pill.addEventListener('click', () => {
      input.value = pill.textContent;
      sendMessage();
    });
  });

  // Typing status logic
  let typingTimeout = null;
  input.addEventListener('input', () => {
    updateTypingStatus(chatRef, user.uid, true);
    if (typingTimeout) clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
      updateTypingStatus(chatRef, user.uid, false);
    }, 2500);
  });

  const sendMessage = async () => {
    const text = input.value.trim();
    if (!text) return;

    input.value = '';
    input.focus();

    import('../utils/audio-manager.js').then(m => {
      m.AudioManager.playSynthMessageSend();
    });

    if (typingTimeout) clearTimeout(typingTimeout);
    updateTypingStatus(chatRef, user.uid, false);

    try {
      await addDoc(messagesRef, {
        senderId: user.uid,
        senderName: displayName,
        text,
        type: 'text',
        timestamp: serverTimestamp(),
        read: false,
      });

      await updateDoc(chatRef, {
        lastMessage: text,
        lastMessageAt: serverTimestamp(),
      });
    } catch (err) {
      console.error('Error sending message:', err);
      input.value = text;
    }
  };

  sendBtn.addEventListener('click', sendMessage);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
}

function renderMessages(container, messages, currentUserId, { chatId, orderId, chatType } = {}) {
  if (messages.length === 0) {
    container.innerHTML = `
      <div class="chat-empty">
        ${icon('chatBubble', 48)}
        <p>Iniciá la conversación</p>
        <span>Los mensajes aparecerán aquí</span>
      </div>
    `;
    return;
  }

  let html = '';
  let lastDate = '';

  messages.forEach((msg, index) => {
    const isMine = msg.senderId === currentUserId;
    const time = msg.timestamp?.toDate?.();
    const timeStr = time ? time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    const dateStr = time ? time.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' }) : '';

    if (dateStr && dateStr !== lastDate) {
      html += `<div class="chat-date-separator"><span>${dateStr}</span></div>`;
      lastDate = dateStr;
    }

    const prevMsg = messages[index - 1];
    const isConsecutive = prevMsg && prevMsg.senderId === msg.senderId;
    const isSystem = msg.senderId === 'system';

    if (isSystem) {
      html += `<div class="chat-system-msg"><span>${msg.text}</span></div>`;
      return;
    }

    html += `
      <div class="chat-bubble-row ${isMine ? 'is-mine' : 'is-other'} ${isConsecutive ? 'consecutive' : ''}">
        ${!isMine && !isConsecutive ? `<div class="chat-bubble-name">${msg.senderName}</div>` : ''}
        <div class="chat-bubble ${isMine ? 'bubble-mine' : 'bubble-other'} ${msg.type === 'image' ? 'bubble-image' : ''}">
          ${msg.type === 'image' ? `
            <div class="chat-image-container" data-url="${msg.imageUrl}">
              <img src="${msg.imageUrl || ''}" class="chat-img" style="${msg.status === 'uploading' ? 'filter: blur(4px); opacity: 0.5;' : ''}" />
              ${msg.status === 'uploading' ? `
                <div class="img-loader-overlay">
                  <div class="spinner-small"></div>
                  <span>${msg.text || 'Cargando...'}</span>
                </div>
              ` : `
                <div class="img-expand-hint">${icon('eye', 12)} Ver</div>
              `}
            </div>
          ` : `
            <span class="bubble-text">${escapeHtml(msg.text)}</span>
          `}
          <span class="bubble-time">${timeStr}${isMine ? ` ${msg.read ? '✓✓' : '✓'}` : ''}</span>
        </div>
        
        <!-- Action: Mark as Paid (Only for Commerce) -->
        ${!isMine && msg.type === 'image' && msg.status !== 'uploading' && chatType === 'client-commerce' && !msg.paidChecked ? `
          <div class="chat-bubble-actions">
            <button class="btn-mark-paid" onclick="window.markAsPaid('${chatId}', '${orderId}', '${msg.id}')">
              ${icon('checkCircle', 14)} Marcar como pagado
            </button>
          </div>
        ` : msg.paidChecked ? `
          <div class="paid-verified-badge">${icon('checkCircle', 12)} Pago verificado</div>
        ` : ''}
      </div>
    `;
  });

  container.innerHTML = html;
  requestAnimationFrame(() => {
    container.scrollTop = container.scrollHeight;
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

async function updateTypingStatus(chatRef, uid, isTyping) {
  try {
    await updateDoc(chatRef, {
      [`typing.${uid}`]: isTyping
    });
  } catch (e) {
    // Ignore updates before document is initialized or permissions issues
  }
}

function showTypingIndicator(chatId, show, otherName) {
  const container = document.getElementById(`chat-typing-indicator-${chatId}`);
  if (!container) return;

  if (show) {
    container.innerHTML = `
      <div class="typing-bubble">
        <span class="typing-text">${otherName} está escribiendo</span>
        <div class="typing-dots">
          <span></span><span></span><span></span>
        </div>
      </div>
    `;
    container.style.display = 'block';
    
    // Auto scroll messages to bottom if user is typing
    const msgsCont = document.getElementById(`chat-messages-${chatId}`);
    if (msgsCont) {
      msgsCont.scrollTop = msgsCont.scrollHeight;
    }
  } else {
    container.innerHTML = '';
    container.style.display = 'none';
  }
}
