// GoDelivery — In-App Chat Component (Real-Time via Firestore)
import { db } from '../firebase.js';
import { collection, doc, setDoc, addDoc, getDoc, onSnapshot, query, orderBy, serverTimestamp, updateDoc, arrayUnion, increment } from 'firebase/firestore';
import { getState } from '../state.js';
import { showModal, closeModal } from './modal.js';
import { registerUnsubscribe } from '../utils/cleanup.js';
import { icon } from '../utils/icons.js';

let isChatOpening = false;

window.playCustomAudio = function(btnEl) {
  const container = btnEl.closest('.wa-audio-player');
  if (!container) return;
  const audio = container.querySelector('audio');
  const seekbar = container.querySelector('.wa-audio-seek');
  const timeDisplay = container.querySelector('.wa-audio-time');
  const iconSpan = btnEl.querySelector('.wa-play-icon');
  const handle = container.querySelector('.wa-waveform-handle');
  const bars = container.querySelectorAll('.wa-waveform-bar');

  if (!audio) return;

  const isMine = container.closest('.chat-bubble')?.classList.contains('bubble-mine');
  const fillClr = isMine ? 'white' : '#54656f';
  
  const playSvg = `<svg viewBox="0 0 24 24" width="16" height="16" fill="${fillClr}" style="display:block;"><path d="M8 5v14l11-7z"/></svg>`;
  const pauseSvg = `<svg viewBox="0 0 24 24" width="16" height="16" fill="${fillClr}" style="display:block;"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`;

  document.querySelectorAll('audio.wa-chat-audio').forEach(a => {
    if (a !== audio && !a.paused) {
      a.pause();
      const parent = a.closest('.wa-audio-player');
      if (parent) {
        const ic = parent.querySelector('.wa-play-icon');
        const pIsMine = parent.closest('.chat-bubble')?.classList.contains('bubble-mine');
        const pFill = pIsMine ? 'white' : '#54656f';
        if (ic) ic.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="${pFill}" style="display:block;"><path d="M8 5v14l11-7z"/></svg>`;
      }
    }
  });

  if (audio.paused) {
    audio.play().then(() => {
      if (iconSpan) iconSpan.innerHTML = pauseSvg;
    }).catch(err => console.error("Playback error:", err));
  } else {
    audio.pause();
    if (iconSpan) iconSpan.innerHTML = playSvg;
  }

  const updateVisuals = () => {
    if (audio.duration) {
      const pct = (audio.currentTime / audio.duration) * 100;
      if (seekbar) seekbar.value = pct;
      if (handle) handle.style.left = `${pct}%`;
      
      const activeCount = Math.floor((pct / 100) * bars.length);
      bars.forEach((bar, idx) => {
        if (isMine) {
          bar.style.backgroundColor = idx <= activeCount ? '#34b7f1' : 'rgba(255, 255, 255, 0.25)';
        } else {
          bar.style.backgroundColor = idx <= activeCount ? '#34b7f1' : '#b1b3b5';
        }
      });

      if (timeDisplay) {
        const curM = Math.floor(audio.currentTime / 60);
        const curS = Math.floor(audio.currentTime % 60).toString().padStart(2, '0');
        timeDisplay.textContent = `${curM}:${curS}`;
      }
    }
  };

  if (!audio._boundEvents) {
    audio._boundEvents = true;
    
    audio.addEventListener('timeupdate', updateVisuals);

    audio.addEventListener('loadedmetadata', () => {
      if (timeDisplay && audio.duration) {
        const durM = Math.floor(audio.duration / 60) || 0;
        const durS = Math.floor(audio.duration % 60).toString().padStart(2, '0');
        timeDisplay.textContent = `${durM}:${durS}`;
      }
    });

    audio.addEventListener('ended', () => {
      if (iconSpan) iconSpan.innerHTML = playSvg;
      if (seekbar) seekbar.value = 0;
      if (handle) handle.style.left = '0%';
      bars.forEach(bar => {
        bar.style.backgroundColor = isMine ? 'rgba(255, 255, 255, 0.25)' : '#b1b3b5';
      });
      if (timeDisplay && audio.duration) {
        const durM = Math.floor(audio.duration / 60) || 0;
        const durS = Math.floor(audio.duration % 60).toString().padStart(2, '0');
        timeDisplay.textContent = `${durM}:${durS}`;
      }
    });

    if (seekbar) {
      seekbar.addEventListener('input', (e) => {
        if (audio.duration) {
          audio.currentTime = (e.target.value / 100) * audio.duration;
          updateVisuals();
        }
      });
    }
  }
};

/**
 * Opens a chat modal for a given order.
 */
export async function openChat(options) {
  if (isChatOpening) return;
  isChatOpening = true;

  let orderId, type, otherName, orderNum, senderDisplayName, isAudit;
  if (typeof options === 'string') {
    orderId = options;
    type = 'client-delivery';
    otherName = 'Chat del Pedido';
    orderNum = options.slice(0, 6);
    senderDisplayName = 'Admin';
    isAudit = true;
  } else if (options && typeof options === 'object') {
    orderId = options.orderId;
    type = options.type || 'client-delivery';
    otherName = options.otherName || 'Chat del Pedido';
    orderNum = options.orderNum || (orderId ? orderId.slice(0, 6) : '');
    senderDisplayName = options.senderDisplayName || 'Usuario';
    isAudit = options.isAudit === true;
  } else {
    isChatOpening = false;
    return;
  }

  if (!orderId) {
    isChatOpening = false;
    return;
  }

  const user = getState().user;
  if (!user) {
    isChatOpening = false;
    return;
  }

  // Privacy protection: Comercio users cannot open or view client-delivery private chat
  const { isAdmin } = await import('../auth.js');
  if (type === 'client-delivery' && !isAdmin() && !isAudit) {
    if (user.role === 'comercio' || user.role === 'commerce' || user.comercioId) {
      isChatOpening = false;
      const { showToast } = await import('./toast.js');
      showToast('⚠️ El chat entre el cliente y el repartidor es privado.', 'warning');
      return;
    }
  }

  const chatId = `${orderId}_${type}`;
  const chatRef = doc(db, 'chats', chatId);
  const messagesRef = collection(chatRef, 'messages');

  let unsub = () => {};
  let orderUnsub = () => {};
  let chatDocUnsub = () => {};
  let otherUserUnsub = () => {};
  const emojiCategories = {
    'Caritas': ['😊','😂','🤣','😍','😒','😭','😘','🥰','😎','🤩','🤔','🤨','🙄','😏','😴','🤤','😋','😛','😜','🤪','😇','🥳','🥺','😱','😨','😰','😥','😓','😩','😫','😤','😡','😠','🤬','🤢','🤮','🤧','🥵','🥶','🥴','😵','🤯','🤠','🤡','🥳','🤫','🤭','🧐','🤓','😈','👿','👹','👺','💀','👻','👽','🤖','💩','😺','😸','😹','😻','😼','😽','🙀','😿','😾'],
    'Gesto': ['👋','🤚','🖐️','✋','🖖','👌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','✍️','💅','🤳','💪','🦾','🦵','🦿','🦶','👣','👂','🦻','👃','🧠','🦷','🦴','👀','👁️','👅','👄','💋'],
    'Entrega': ['🛵','🚚','🚛','🚲','🏎️','🏍️','📍','🏁','⛽','🚦','🚧','🗺️','📦','🎁','🏠','🏢','🏦','🏪','🛒','👜','🛍️','💰','💵','💳','🧾','⏰','⏳','⏱️','🔋','📶','📱','📞','💬'],
    'Comida': ['🍕','🍔','🍟','🌭','🥪','🌮','🌯','🍳','🥘','🍲','🥣','🥗','🍿','🍱','🍙','🍚','🍛','🍜','🍝','🍠','🍢','🍣','🍤','🍥','🥮','🍡','🥟','🥠','🍦','🍧','🍨','🍩','🍪','🎂','🍰','🧁','🥧','🍫','🍬','🍭','🍮','🍼','🥛','☕','🍵','🥤','🍶','🍺','🍻','🍷','🍸','🍹','🥃','🧉','🥂']
  };

  // Build chat UI shell INSTANTLY
  const chatContainer = document.createElement('div');
  chatContainer.className = 'chat-container';
  chatContainer.innerHTML = `
    <div class="chat-header-bar" style="background: linear-gradient(135deg, var(--color-primary) 0%, #be123c 100%); color: white; border-radius: 0; padding: calc(14px + env(safe-area-inset-top, 0px)) 16px 14px; display: flex; align-items: center; gap: 8px; border-bottom: 1px solid rgba(255,255,255,0.15); box-sizing: border-box;">
      <button class="chat-back-btn" id="chat-back-${chatId}" style="background: none; border: none; color: white; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 4px; margin-right: 2px; transition: transform 0.2s;" onmousedown="this.style.transform='scale(0.85)'" onmouseup="this.style.transform='scale(1)'" onmouseleave="this.style.transform='scale(1)'" ontouchstart="this.style.transform='scale(0.85)'" ontouchend="this.style.transform='scale(1)'">
        ${icon('chevronLeft', 24)}
      </button>
      <div class="chat-avatar" style="background: rgba(255,255,255,0.2); color: white; width: 38px; height: 38px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
        ${type === 'client-commerce' ? icon('store', 20) : icon('bike', 20)}
      </div>
      <div class="chat-header-info" style="flex: 1; min-width: 0;">
        <div class="chat-header-name" style="font-size: 15px; font-weight: 900; color: white; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${otherName}</div>
        <div class="chat-header-order" style="font-size: 11.5px; opacity: 0.9; font-weight: 750; color: rgba(255,255,255,0.9);">Pedido #${orderNum || '---'}</div>
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
      <div class="chat-input-bar" style="position:relative; width:100%; box-sizing:border-box;">
        <button class="chat-emoji-btn" id="emoji-btn-${chatId}">${icon('smile', 22)}</button>
        <button class="chat-attach-btn" id="chat-attach-${chatId}" title="Adjuntar imagen" style="color:var(--color-text-secondary);">${icon('camera', 22)}</button>
        <input type="file" id="chat-file-gallery-${chatId}" style="display:none" accept="image/*" />
        <input type="file" id="chat-file-camera-${chatId}" style="display:none" accept="image/*" capture="environment" />
        <input type="text" id="chat-input-${chatId}" class="chat-input" placeholder="Escribí un mensaje..." autocomplete="off" />
        
        <div id="chat-audio-indicator-${chatId}" style="display:none; position:absolute; inset:0; background:var(--color-surface); align-items:center; justify-content:space-between; padding:0 16px; border-radius:18px; z-index:50; border:1.5px solid var(--color-border);">
          <div style="display:flex; align-items:center; gap:8px;">
            <div class="recording-dot" style="width: 8px; height: 8px; background: #e11d48; border-radius: 50%; animation: pulse 1s infinite;"></div>
            <span id="chat-audio-timer-${chatId}" style="font-weight: 800; font-size: 14px; color:var(--color-text-primary); font-family:var(--font-display);">0:00</span>
          </div>
          <div id="chat-audio-slidehint-${chatId}" style="display:flex; align-items:center; gap:4px; position:absolute; right:125px; color: var(--color-text-primary); font-size: 13px; font-weight: 850; pointer-events:none; animation: slideHint 1.5s infinite; white-space:nowrap;">
            <span style="font-size:16px; margin-right:2px; font-weight:900;">‹</span> Desliza para cancelar
          </div>
        </div>

        <button class="chat-mic-btn" id="chat-mic-${chatId}" title="Grabar audio" style="color:var(--color-primary); z-index:60; position:relative; touch-action:none; -webkit-user-select:none; user-select:none; -webkit-touch-callout:none;">${icon('mic', 22)}</button>
        <button class="chat-send-btn" id="chat-send-${chatId}" style="z-index:60; position:relative;">${icon('send', 20)}</button>
      </div>
    </div>
  `;

  let viewportListener = null;

  const modalInstance = showModal({
    title: '',
    content: chatContainer,
    hideHeader: true,
    fullSwipe: false,
    height: '100dvh',
    fullscreen: true,
    slideFromRight: true,
    onClose: () => {
      if (unsub) unsub();
      if (orderUnsub) orderUnsub();
      if (chatDocUnsub) chatDocUnsub();
      if (otherUserUnsub) otherUserUnsub();
      if (viewportListener && window.visualViewport) {
        window.visualViewport.removeEventListener('resize', viewportListener);
        window.visualViewport.removeEventListener('scroll', viewportListener);
      }
      updateTypingStatus(chatRef, user.uid, false);
      isChatOpening = false;
    }
  });

  // References to DOM
  const messagesContainer = document.getElementById(`chat-messages-${chatId}`);
  if (!messagesContainer) return;

  // Wire back button close action
  const backBtn = document.getElementById(`chat-back-${chatId}`);
  if (backBtn) {
    backBtn.onclick = () => closeModal();
  }

  // Setup input listeners IMMEDIATELY (0ms) on DOM insertion so input doesn't wait for network
  setupInputListeners(chatId, messagesRef, user, chatRef, senderDisplayName);

  // Visual Viewport Adaptability for Keyboard (WhatsApp style)
  if (window.visualViewport) {
    viewportListener = () => {
      const keyboardHeight = window.innerHeight - window.visualViewport.height;
      if (keyboardHeight > 80) {
        chatContainer.style.paddingBottom = `${keyboardHeight}px`;
        setTimeout(() => {
          if (messagesContainer) {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
          }
        }, 80);
      } else {
        chatContainer.style.paddingBottom = '0px';
      }
    };
    window.visualViewport.addEventListener('resize', viewportListener);
    window.visualViewport.addEventListener('scroll', viewportListener);
  }

  // Real-time messages listener
  const q = query(messagesRef, orderBy('timestamp', 'asc'));
  let isInitialLoad = true;
  unsub = onSnapshot(q, (snap) => {
    registerUnsubscribe(unsub);
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

    renderMessages(messagesContainer, messages, user.uid, { chatId, orderId, chatType: type, isAudit });
    initReactionListeners(messagesContainer, user, messagesRef, chatId);

    // Mark unread messages as read
    let markedAny = false;
    snap.docs.forEach(d => {
      const msg = d.data();
      if (msg.senderId !== user.uid && !msg.read) {
        updateDoc(doc(messagesRef, d.id), { read: true, readAt: new Date().toISOString() });
        markedAny = true;
      }
    });
    if (markedAny) {
      updateDoc(chatRef, {
        [`unread.${user.uid}`]: 0
      }).catch(() => {});
    }
  });

  // Background Tasks (Status & Init)
  orderUnsub = () => { };
  chatDocUnsub = () => { };
  (async () => {
    let isReadOnly = isAudit;
    let orderData = null;
    try {
      // 1. Get current order status
      const orderSnap = await getDoc(doc(db, 'orders', orderId));
      if (orderSnap.exists()) {
        orderData = orderSnap.data();
        const orderStatus = orderData.status;
        isReadOnly = isAudit || orderStatus === 'completed' || orderStatus === 'cancelled';

        // Load profile photo of the other party
        let otherId = null;
        let headerTitle = otherName;
        if (type === 'client-commerce') {
          const isUserCommerce = (senderDisplayName === 'Comercio') || 
                                 (user.uid === orderData.comercioId) || 
                                 (orderData.comercioOwnerId && user.uid === orderData.comercioOwnerId);
          otherId = isUserCommerce ? orderData.userId : orderData.comercioId;
          if (isAudit) {
            headerTitle = `${orderData.userName || 'Cliente'} ↔ ${orderData.comercioName || 'Comercio'}`;
          } else {
            headerTitle = isUserCommerce ? (orderData.userName || 'Cliente') : (orderData.comercioName || 'Comercio');
          }
        } else if (type === 'client-delivery') {
          otherId = user.uid === orderData.userId ? orderData.driverId : orderData.userId;
          const isSearchingDriver = orderData.status === 'ready' || orderData.isFavor || orderData.isTrip;
          const defaultNoDriverLabel = isSearchingDriver ? 'Buscando repartidor...' : ((orderData.status === 'confirmed' || orderData.status === 'preparing') ? 'En preparación' : 'Sin repartidor asignado');
          if (isAudit) {
            headerTitle = `${orderData.userName || 'Cliente'} ↔ ${orderData.driverName || defaultNoDriverLabel}`;
          } else if (user.uid === orderData.userId) {
            headerTitle = orderData.driverName || defaultNoDriverLabel;
          } else {
            headerTitle = orderData.userName || 'Cliente';
          }
        } else if (type === 'commerce-delivery') {
          const isUserCommerce = (senderDisplayName === 'Comercio') || 
                                 (user.uid === orderData.comercioId) || 
                                 (orderData.comercioOwnerId && user.uid === orderData.comercioOwnerId);
          otherId = isUserCommerce ? orderData.driverId : orderData.comercioId;
          const isSearchingDriver = orderData.status === 'ready' || orderData.isFavor || orderData.isTrip;
          const defaultNoDriverLabel = isSearchingDriver ? 'Buscando repartidor...' : ((orderData.status === 'confirmed' || orderData.status === 'preparing') ? 'En preparación' : 'Sin repartidor asignado');
          if (isAudit) {
            headerTitle = `${orderData.comercioName || 'Comercio'} ↔ ${orderData.driverName || defaultNoDriverLabel}`;
          } else {
            headerTitle = isUserCommerce ? (orderData.driverName || defaultNoDriverLabel) : (orderData.comercioName || 'Comercio');
          }
        }

        const nameEl = chatContainer.querySelector('.chat-header-name');
        if (nameEl && headerTitle) {
          nameEl.textContent = headerTitle;
        }

        if (otherId) {
          otherUserUnsub = onSnapshot(doc(db, 'users', otherId), async (uSnap) => {
            if (uSnap.exists()) {
              const uData = uSnap.data();
              let photo = uData.photoURL || uData.profilePhoto || null;
              
              const isCommerceParty = (type === 'client-commerce' && otherId === orderData.comercioId) ||
                                      (type === 'commerce-delivery' && otherId === orderData.comercioId);
                                      
              if (isCommerceParty || uData.role === 'comercio' || uData.role === 'commerce') {
                const comSnap = await getDoc(doc(db, 'comercios', orderData.comercioId || otherId));
                if (comSnap.exists()) {
                  const comData = comSnap.data();
                  photo = comData.logoUrl || comData.logo || comData.image || photo;
                }
              }
              if (photo) {
                const avatarEl = chatContainer.querySelector('.chat-avatar');
                if (avatarEl) {
                  avatarEl.innerHTML = `<img src="${photo}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;" />`;
                  avatarEl.style.background = 'none';
                }
              }

              // Update online indicator dot
              const nameEl = chatContainer.querySelector('.chat-header-name');
              if (nameEl) {
                nameEl.querySelector('.online-indicator-dot')?.remove();
                if (uData.isOnline === true) {
                  nameEl.insertAdjacentHTML('beforeend', `
                    <span class="online-indicator-dot" style="display:inline-block; width:8px; height:8px; background:#10b981; border-radius:50%; margin-left:6px; box-shadow:0 0 8px #10b981; animation:pulse 2s infinite;"></span>
                  `);
                }
              }
            }
          }, err => console.warn('Failed to subscribe to chat user status:', err));
          registerUnsubscribe(otherUserUnsub);
        }

        // 2. Ensure chat document exists (only if not auditing)
        if (!isAudit) {
          const parts = [user.uid];
          if (otherId) parts.push(otherId);
          await setDoc(chatRef, {
            orderId,
            type,
            participants: arrayUnion(...parts),
            lastActivityAt: serverTimestamp(),
          }, { merge: true });
        }

        // Clear unread flag for this user
        await updateDoc(chatRef, {
          [`unread.${user.uid}`]: 0
        }).catch(() => {});
      }

      // Update UI with footer and status ONLY if read-only (do not destroy active DOM input)
      const statusIndicator = document.getElementById(`chat-status-indicator-${chatId}`);
      if (statusIndicator && isReadOnly) {
        statusIndicator.innerHTML = `<div class="chat-status-badge">${icon('lock', 12)} ${isAudit ? 'Auditoría' : 'Finalizado'}</div>`;
      }

      const footerArea = document.getElementById(`chat-footer-area-${chatId}`);
      if (footerArea && isReadOnly) {
        footerArea.innerHTML = `
          <div class="chat-closed-bar">
            ${icon('lock', 16)}
            <span>${isAudit ? 'Modo Auditoría (Solo Lectura)' : 'Este chat ha finalizado'}</span>
          </div>
        `;
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
        registerUnsubscribe(orderUnsub);
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
      registerUnsubscribe(chatDocUnsub);
    } catch (e) {
      console.error('Chat background init error:', e);
    }
  })();

  // Delegated listener for Lightbox
  messagesContainer.addEventListener('click', (e) => {
    const imgContainer = e.target.closest('.chat-image-container');
    if (imgContainer && imgContainer.dataset.url && imgContainer.dataset.url !== 'undefined') {
      window.openLightbox(imgContainer.dataset.url);
    }
  });
}

async function updateChatMetadata(chatRef, uid, lastMessageText) {
  try {
    let chatSnap = await getDoc(chatRef);
    let chatData = chatSnap.exists() ? chatSnap.data() : {};
    let participants = chatData.participants || [uid];

    const chatId = chatRef.id;
    const parts = chatId.split('_');
    const orderId = chatData.orderId || parts[0];
    const chatType = chatData.type || parts[1];

    let orderParties = new Set();
    if (orderId) {
      try {
        const orderSnap = await getDoc(doc(db, 'orders', orderId));
        if (orderSnap.exists()) {
          const oData = orderSnap.data();
          if (oData.userId) orderParties.add(oData.userId);
          if (oData.driverId) orderParties.add(oData.driverId);
          if (oData.comercioId) orderParties.add(oData.comercioId);
          if (oData.comercioOwnerId) orderParties.add(oData.comercioOwnerId);
          
          if (orderParties.size > 0) {
            participants = Array.from(orderParties);
          }
        }
      } catch (err) {
        console.warn('Failed to fetch order for chat metadata fallback:', err);
      }
    }

    const updates = {
      orderId: orderId || '',
      type: chatType || '',
      participants: arrayUnion(...participants),
      lastMessage: lastMessageText,
      lastMessageAt: serverTimestamp(),
      lastActivityAt: serverTimestamp(),
      [`unread.${uid}`]: 0
    };

    participants.forEach(pId => {
      if (pId !== uid && (orderParties.size === 0 || orderParties.has(pId))) {
        updates[`unread.${pId}`] = increment(1);
      }
    });

    await setDoc(chatRef, updates, { merge: true });

    // Push notification trigger to all other participants
    const { collection, addDoc } = await import('firebase/firestore');
    
    let displayName = chatType === 'client-commerce' ? (uid === (chatData.userId || orderId) ? 'Cliente' : 'Comercio') : 'Mensaje';
    if (orderId) {
      const orderSnap = await getDoc(doc(db, 'orders', orderId));
      if (orderSnap.exists()) {
        const orderData = orderSnap.data();
        if (chatType === 'client-commerce') {
          displayName = uid === orderData.userId ? (orderData.userName || 'Cliente') : (orderData.comercioName || 'Comercio');
        } else if (chatType === 'client-delivery') {
          displayName = uid === orderData.userId ? (orderData.userName || 'Cliente') : (orderData.driverName || 'Repartidor');
        } else if (chatType === 'commerce-delivery') {
          displayName = uid === orderData.comercioId ? (orderData.comercioName || 'Comercio') : (orderData.driverName || 'Repartidor');
        }
      }
    }

    for (const pId of participants) {
      if (pId !== uid) {
        await addDoc(collection(db, 'notifications'), {
          userId: pId,
          title: `💬 ${displayName}`,
          body: lastMessageText,
          type: 'new_chat_message',
          chatId: chatRef.id,
          orderId: orderId || '',
          url: `#/mis-chats?chatId=${chatRef.id}`,
          createdAt: new Date(),
          read: false
        });
      }
    }
  } catch (e) {
    console.error("Error updating chat metadata:", e);
  }
}

function setupInputListeners(chatId, messagesRef, user, chatRef, senderDisplayName) {
  const input = document.getElementById(`chat-input-${chatId}`);
  const sendBtn = document.getElementById(`chat-send-${chatId}`);
  const fileInputGallery = document.getElementById(`chat-file-gallery-${chatId}`);
  const fileInputCamera = document.getElementById(`chat-file-camera-${chatId}`);
  const attachBtn = document.getElementById(`chat-attach-${chatId}`);
  const micBtn = document.getElementById(`chat-mic-${chatId}`);
  const audioIndicator = document.getElementById(`chat-audio-indicator-${chatId}`);
  const audioTimer = document.getElementById(`chat-audio-timer-${chatId}`);

  const emojiBtn = document.getElementById(`emoji-btn-${chatId}`);
  const emojiPicker = document.getElementById(`emoji-picker-${chatId}`);

  if (!input || !sendBtn) return;
  if (input.dataset.bound) return;
  input.dataset.bound = 'true';

  // WhatsApp-Grade Audio Recording State Engine
  let mediaRecorder = null;
  let audioChunks = [];
  let recordStartTime = 0;
  let recordTimer = null;
  let isRecording = false;
  let isPendingPermission = false;
  let didCancel = false;
  let startX = 0;
  let currentDeltaX = 0;

  const resetRecordingUI = () => {
    isRecording = false;
    isPendingPermission = false;
    currentDeltaX = 0;
    if (recordTimer) clearInterval(recordTimer);
    if (audioIndicator) audioIndicator.style.display = 'none';
    const slideHint = document.getElementById(`chat-audio-slidehint-${chatId}`);
    if (slideHint) slideHint.style.opacity = '1';
    if (micBtn) {
      micBtn.style.transition = '';
      micBtn.style.backgroundColor = '';
      micBtn.style.color = '';
      micBtn.style.transform = '';
      micBtn.style.boxShadow = '';
      micBtn.style.borderRadius = '';
      micBtn.innerHTML = icon('mic', 22);
    }
  };

  const startRecording = async (e) => {
    if (isRecording || isPendingPermission) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      import('./toast.js').then(m => m.showToast('Micrófono no soportado en este dispositivo', 'error'));
      return;
    }

    startX = e ? e.clientX : 0;
    currentDeltaX = 0;
    didCancel = false;
    isPendingPermission = true;

    // Immediate visual feedback on touch down
    micBtn.style.backgroundColor = 'var(--color-primary)';
    micBtn.style.color = 'white';
    micBtn.style.transform = 'scale(1.35)';
    micBtn.style.boxShadow = '0 0 18px rgba(225, 29, 72, 0.55)';
    micBtn.style.borderRadius = '50%';

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // If user released touch while permission prompt was open, cancel clean
      if (didCancel) {
        stream.getTracks().forEach(track => track.stop());
        resetRecordingUI();
        return;
      }

      let mimeType = 'audio/webm';
      let fileExt = 'webm';
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported) {
        if (MediaRecorder.isTypeSupported('audio/mp4')) {
          mimeType = 'audio/mp4';
          fileExt = 'mp4';
        } else if (MediaRecorder.isTypeSupported('audio/aac')) {
          mimeType = 'audio/aac';
          fileExt = 'm4a';
        } else if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
          mimeType = 'audio/webm;codecs=opus';
          fileExt = 'webm';
        } else if (MediaRecorder.isTypeSupported('audio/webm')) {
          mimeType = 'audio/webm';
          fileExt = 'webm';
        }
      }

      mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      audioChunks = [];

      mediaRecorder.ondataavailable = ev => {
        if (ev.data.size > 0) audioChunks.push(ev.data);
      };

      mediaRecorder.onstart = () => {
        isPendingPermission = false;
        isRecording = true;
        recordStartTime = Date.now();
        if (audioIndicator) audioIndicator.style.display = 'flex';
        if (audioTimer) audioTimer.textContent = '0:00';

        recordTimer = setInterval(() => {
          const elapsed = Math.floor((Date.now() - recordStartTime) / 1000);
          const m = Math.floor(elapsed / 60);
          const s = (elapsed % 60).toString().padStart(2, '0');
          if (audioTimer) audioTimer.textContent = `${m}:${s}`;
        }, 1000);
      };

      mediaRecorder.onstop = async () => {
        const wasCancelled = didCancel || currentDeltaX > 120;
        const recordedChunks = [...audioChunks];
        const elapsedMs = Date.now() - recordStartTime;
        
        stream.getTracks().forEach(track => track.stop());
        resetRecordingUI();

        if (wasCancelled) {
          import('./toast.js').then(m => m.showToast('Grabación cancelada', 'warning'));
          return;
        }

        if (recordedChunks.length > 0) {
          if (elapsedMs < 900) {
            import('./toast.js').then(m => m.showToast('Audio muy corto', 'warning'));
            return;
          }
          import('./toast.js').then(m => m.showToast('Enviando audio...', 'info'));
          try {
             const { getStorage, ref, uploadBytes, getDownloadURL } = await import('firebase/storage');
             const storage = getStorage();
             const finalMime = mediaRecorder.mimeType || mimeType || 'audio/mp4';
             const fileName = `chats/${chatId}/audio_${Date.now()}.${fileExt}`;
             const storageRef = ref(storage, fileName);
             const audioBlob = new Blob(recordedChunks, { type: finalMime });
             
             await uploadBytes(storageRef, audioBlob);
             const downloadURL = await getDownloadURL(storageRef);
             
              await addDoc(messagesRef, {
                 senderId: user.uid,
                 senderName: displayName,
                 senderPhoto: user.photoURL || user.profilePhoto || null,
                 text: 'Mensaje de voz',
                 type: 'audio',
                 audioUrl: downloadURL,
                 timestamp: serverTimestamp(),
                 read: false
              });
             
             await updateChatMetadata(chatRef, user.uid, '🎤 Mensaje de voz');
             import('./toast.js').then(m => m.showToast('Audio enviado', 'success'));
          } catch (error) {
             console.error("Error sending audio:", error);
             import('./toast.js').then(m => m.showToast('Error al enviar audio', 'error'));
          }
        }
      };

      mediaRecorder.start();
    } catch (err) {
      console.error("Mic access error or denied:", err);
      resetRecordingUI();
      import('./toast.js').then(m => m.showToast('Permiso de micrófono no otorgado', 'error'));
    }
  };

  const stopRecording = (cancel = false) => {
    if (cancel) didCancel = true;
    if (isPendingPermission) {
      didCancel = true;
      resetRecordingUI();
      return;
    }
    if (isRecording && mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    } else {
      resetRecordingUI();
    }
  };

  const getClientX = (e) => {
    if (!e) return 0;
    if (e.touches && e.touches.length > 0) return e.touches[0].clientX;
    if (e.changedTouches && e.changedTouches.length > 0) return e.changedTouches[0].clientX;
    return e.clientX || 0;
  };

  let touchActive = false;

  const onDragMove = (e) => {
    if (e.cancelable) e.preventDefault();
    if (!isRecording && !isPendingPermission) return;
    const x = getClientX(e);
    const deltaX = Math.max(0, startX - x);
    currentDeltaX = deltaX;

    if (deltaX > 2) {
      const clampedX = Math.min(deltaX, 220);
      micBtn.style.transform = `scale(1.35) translateX(-${clampedX}px)`;
      
      const slideHint = document.getElementById(`chat-audio-slidehint-${chatId}`);
      if (slideHint) {
        const opacity = Math.max(0, 1 - (clampedX / 100));
        slideHint.style.opacity = opacity;
      }

      if (deltaX > 120) {
        micBtn.innerHTML = `<span style="font-size:18px; font-weight:900; color:white;">🗑️</span>`;
        micBtn.style.backgroundColor = '#ef4444';
      } else {
        micBtn.innerHTML = `<span style="font-size:18px; font-weight:900; color:white;">‹</span>`;
        micBtn.style.backgroundColor = 'var(--color-primary)';
      }
    } else {
      micBtn.style.transform = 'scale(1.3)';
      micBtn.innerHTML = icon('mic', 22);
      micBtn.style.backgroundColor = 'var(--color-primary)';
    }
  };

  const onDragEnd = (e) => {
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragEnd);
    window.removeEventListener('pointercancel', onDragEnd);
    
    window.removeEventListener('touchmove', onDragMove);
    window.removeEventListener('touchend', onDragEnd);
    window.removeEventListener('touchcancel', onDragEnd);

    setTimeout(() => { touchActive = false; }, 300);

    if (currentDeltaX > 120) {
      stopRecording(true);
    } else {
      stopRecording(false);
    }
  };

  const handleDragStart = (e) => {
    if (e.type === 'touchstart') touchActive = true;
    else if (e.type === 'pointerdown' && touchActive) return;

    if (document.activeElement && document.activeElement.blur) {
      document.activeElement.blur();
    }
    if (input) input.blur();

    const x = getClientX(e);
    startX = x;
    currentDeltaX = 0;

    if (micBtn) {
      micBtn.style.transition = 'none';
    }

    if (e.type === 'touchstart') {
      window.addEventListener('touchmove', onDragMove, { passive: false });
      window.addEventListener('touchend', onDragEnd, { passive: false });
      window.addEventListener('touchcancel', onDragEnd, { passive: false });
    } else {
      window.addEventListener('pointermove', onDragMove);
      window.addEventListener('pointerup', onDragEnd);
      window.addEventListener('pointercancel', onDragEnd);
    }

    startRecording({ clientX: x });
  };

  micBtn.addEventListener('touchstart', handleDragStart, { passive: true });
  micBtn.addEventListener('pointerdown', handleDragStart);

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

  // Do not auto-focus input on chat open so virtual keyboard stays closed

  const displayName = senderDisplayName || user.displayName || 'Usuario';

  attachBtn?.addEventListener('click', () => {
    showModal({
      title: 'Enviar imagen',
      content: `
        <div style="padding: 24px 20px calc(24px + env(safe-area-inset-bottom, 0px)) 20px; display: flex; flex-direction: column; gap: 16px;">
          <button id="btn-use-camera-${chatId}" style="width: 100%; height: 56px; border-radius: 18px; background: var(--color-primary); color: white; border: none; font-weight: 850; font-size: 15px; display: flex; align-items: center; justify-content: center; gap: 10px; cursor: pointer; box-shadow: 0 8px 20px rgba(var(--color-primary-rgb), 0.25);">
            ${icon('camera', 20)} Tomar Foto (Cámara)
          </button>
          <button id="btn-use-gallery-${chatId}" style="width: 100%; height: 56px; border-radius: 18px; background: var(--color-bg-secondary); border: 1.5px solid var(--color-border); color: var(--color-text-primary); font-weight: 850; font-size: 15px; display: flex; align-items: center; justify-content: center; gap: 10px; cursor: pointer;">
            ${icon('image', 20)} Seleccionar de Galería
          </button>
        </div>
      `,
      height: 'auto',
      onOpen: () => {
        const btnCamera = document.getElementById(`btn-use-camera-${chatId}`);
        const btnGallery = document.getElementById(`btn-use-gallery-${chatId}`);
        
        if (btnCamera) {
          btnCamera.onclick = async () => {
            closeModal();
            try {
              const { Capacitor } = await import('@capacitor/core');
              if (Capacitor.isNativePlatform()) {
                const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera');
                const photo = await Camera.getPhoto({
                  quality: 85,
                  allowEditing: false,
                  resultType: CameraResultType.Uri,
                  source: CameraSource.Camera
                });
                const response = await fetch(photo.webPath);
                const blob = await response.blob();
                const file = new File([blob], `camera_${Date.now()}.jpg`, { type: 'image/jpeg' });
                handleFileSelect(file);
              } else {
                fileInputCamera?.click();
              }
            } catch (err) {
              console.warn("Capacitor camera error, falling back to input file click", err);
              fileInputCamera?.click();
            }
          };
        }
        if (btnGallery) {
          btnGallery.onclick = () => {
            closeModal();
            fileInputGallery?.click();
          };
        }
      }
    });
  });

  const compressImage = async (file, maxDimension = 1280, quality = 0.8) => {
    return new Promise((resolve) => {
      if (!file || !file.type || !file.type.startsWith('image/')) {
        resolve(file);
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          let width = img.width;
          let height = img.height;
          if (width <= maxDimension && height <= maxDimension) {
            resolve(file);
            return;
          }
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          canvas.toBlob(
            (blob) => {
              if (blob && blob.size < file.size) {
                const compressed = new File([blob], file.name.replace(/\.[^/.]+$/, '.jpg'), {
                  type: 'image/jpeg',
                  lastModified: Date.now()
                });
                resolve(compressed);
              } else {
                resolve(file);
              }
            },
            'image/jpeg',
            quality
          );
        };
        img.onerror = () => resolve(file);
        img.src = e.target.result;
      };
      reader.onerror = () => resolve(file);
      reader.readAsDataURL(file);
    });
  };

  const handleFileSelect = async (rawFile) => {
    if (!rawFile) return;
    if (document.querySelector('.chat-closed-bar')) {
      import('./toast.js').then(m => m.showToast('El chat ha finalizado. No podés enviar mensajes.', 'warning'));
      return;
    }

    const file = await compressImage(rawFile);

    const { ref, uploadBytes, getDownloadURL } = await import('firebase/storage');
    const { storage } = await import('../firebase.js');

    import('../utils/audio-manager.js').then(m => {
      m.AudioManager.playSynthMessageSend();
    });

    const docRef = await addDoc(messagesRef, {
      senderId: user.uid,
      senderName: displayName,
      senderPhoto: user.photoURL || user.profilePhoto || null,
      text: 'Subiendo imagen...',
      type: 'image',
      status: 'uploading',
      timestamp: serverTimestamp(),
      read: false,
    });

    try {
      const fileRef = ref(storage, `chats/${chatId}/${Date.now()}_${file.name}`);
      const metadata = { contentType: file.type || 'image/jpeg' };
      await uploadBytes(fileRef, file, metadata);
      const url = await getDownloadURL(fileRef);

      await updateDoc(docRef, {
        text: '',
        imageUrl: url,
        status: 'ready',
      });

      await updateChatMetadata(chatRef, user.uid, '📷 Imagen');
    } catch (err) {
      console.error('Upload error:', err);
      await updateDoc(docRef, { text: 'Error al subir imagen', status: 'error' });
    }
  };

  fileInputGallery?.addEventListener('change', (e) => {
    closeModal();
    handleFileSelect(e.target.files[0]);
  });

  fileInputCamera?.addEventListener('change', (e) => {
    closeModal();
    handleFileSelect(e.target.files[0]);
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
    if (document.querySelector('.chat-closed-bar')) {
      import('./toast.js').then(m => m.showToast('El chat ha finalizado. No podés enviar mensajes.', 'warning'));
      return;
    }

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
        senderPhoto: user.photoURL || user.profilePhoto || null,
        text,
        type: 'text',
        timestamp: serverTimestamp(),
        read: false,
      });

      await updateChatMetadata(chatRef, user.uid, text);
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

function renderMessages(container, messages, currentUserId, { chatId, orderId, chatType, isAudit = false } = {}) {
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

  // Determine alignment in audit mode: first sender on left, second sender on right
  const firstSenderId = messages.find(m => m.senderId && m.senderId !== 'system')?.senderId;

  messages.forEach((msg, index) => {
    let isMine = false;
    if (isAudit) {
      // In audit mode: align by sender identity so client is on left and commerce/delivery on right (or first sender on left, second on right)
      isMine = (msg.senderId !== firstSenderId);
    } else {
      isMine = (msg.senderId === currentUserId);
    }

    const time = msg.timestamp?.toDate?.();
    const timeStr = time ? time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }).toLowerCase() : '';
    const dateStr = time ? time.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' }) : '';

    let ticksHtml = '';
    // Show ticks if it's my message OR if we are in audit mode (to audit both sides)
    if (isMine || isAudit) {
      const now = Date.now();
      const msgTime = msg.timestamp ? (msg.timestamp.toDate ? msg.timestamp.toDate().getTime() : new Date(msg.timestamp).getTime()) : now;
      const diffSeconds = (now - msgTime) / 1000;

      if (msg.status === 'sending' || !msg.timestamp) {
        ticksHtml = `
          <span class="chat-tick" style="display:inline-flex; align-items:center; vertical-align:middle; line-height:1;">
            <svg width="11" height="11" viewBox="0 0 12 11" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M1.5 5.5L4.5 8.5L10.5 2.5" stroke="rgba(255,255,255,0.45)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </span>
        `;
      } else if (msg.read) {
        // Render double ticks (light blue when visto)
        ticksHtml = `
          <span class="chat-tick" style="display:inline-flex; align-items:center; vertical-align:middle; line-height:1;">
            <svg width="16" height="11" viewBox="0 0 16 11" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M1.5 5.5L4.5 8.5L10.5 2.5" stroke="#34b7f1" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M5.5 5.5L8.5 8.5L14.5 2.5" stroke="#34b7f1" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </span>
        `;
      } else {
        // Render double ticks (white/grey when delivered but unread)
        ticksHtml = `
          <span class="chat-tick" style="display:inline-flex; align-items:center; vertical-align:middle; line-height:1;">
            <svg width="16" height="11" viewBox="0 0 16 11" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M1.5 5.5L4.5 8.5L10.5 2.5" stroke="rgba(255,255,255,0.45)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M5.5 5.5L8.5 8.5L14.5 2.5" stroke="rgba(255,255,255,0.45)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </span>
        `;
      }
    }

    let seenTimeHtml = '';

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

    const showBubbleName = isAudit ? (!isConsecutive && msg.senderName) : (!isMine && !isConsecutive);

    const reactions = msg.reactions || {};
    let reactionsHtml = '';
    const reactionEntries = Object.entries(reactions);
    if (reactionEntries.length > 0) {
      const uniqueEmojis = Array.from(new Set(reactionEntries.map(([uid, emoji]) => emoji)));
      reactionsHtml = `
        <div class="chat-bubble-reactions" style="position:absolute; bottom:-10px; right:10px; background:var(--color-surface); border:1px solid var(--color-border); border-radius:12px; padding:2px 6px; display:inline-flex; align-items:center; gap:2px; box-shadow:0 2px 6px rgba(0,0,0,0.15); z-index:10; font-size:11px; cursor:pointer; user-select:none;">
          ${uniqueEmojis.join('')} ${reactionEntries.length > 1 ? `<span style="font-size:9px; font-weight:800; color:var(--color-text-secondary); margin-left:2px;">${reactionEntries.length}</span>` : ''}
        </div>
      `;
    }

    html += `
      <div class="chat-bubble-row ${isMine ? 'is-mine' : 'is-other'} ${isConsecutive ? 'consecutive' : ''}">
        ${showBubbleName ? `<div class="chat-bubble-name">${msg.senderName}</div>` : ''}
        <div class="chat-bubble ${isMine ? 'bubble-mine' : 'bubble-other'} ${msg.type === 'image' ? 'bubble-image' : ''} ${msg.type === 'audio' ? 'bubble-audio' : ''}" data-msg-id="${msg.id}" style="position:relative;">
          ${msg.type === 'image' ? `
            <div class="chat-image-container" data-url="${msg.imageUrl}">
              <img src="${msg.imageUrl || ''}" class="chat-img" style="${msg.status === 'uploading' ? 'filter: blur(4px); opacity: 0.5;' : (msg.status === 'error' || !msg.imageUrl ? 'display: none;' : '')}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />
              ${msg.status === 'uploading' ? `
                <div class="img-loader-overlay">
                  <div class="spinner-small"></div>
                  <span>${msg.text || 'Cargando...'}</span>
                </div>
              ` : msg.status === 'error' || !msg.imageUrl ? `
                <div class="img-loader-overlay" style="background: rgba(220, 53, 69, 0.8);">
                  <span>${icon('alertCircle', 24)}</span>
                  <span style="text-align: center; font-size: 11px;">Error al subir foto</span>
                </div>
              ` : `
                <div class="img-expand-hint">${icon('eye', 12)} Ver</div>
              `}
            </div>
          ` : msg.type === 'audio' ? `
            <div class="wa-audio-player" style="display:flex; align-items:center; gap:12px; padding:12px 14px; min-width:270px; max-width:320px; box-sizing:border-box;">
              <!-- Avatar Column -->
              <div style="position:relative; width:40px; height:40px; flex-shrink:0;">
                ${msg.senderPhoto ? `
                  <img src="${msg.senderPhoto}" style="width:40px; height:40px; border-radius:50%; object-fit:cover; display:block;" />
                ` : `
                  <div style="width:40px; height:40px; border-radius:50%; background:${isMine ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.06)'}; color:${isMine ? 'white' : 'var(--color-text-primary)'}; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:15px; font-family:var(--font-display);">
                    ${(msg.senderName || 'U')[0].toUpperCase()}
                  </div>
                `}
                <!-- Green mic icon overlap at bottom-right of avatar -->
                <div style="position:absolute; bottom:-3px; right:-3px; background:#00e676; border:2px solid ${isMine ? '#121212' : '#ffffff'}; border-radius:50%; width:18px; height:18px; display:flex; align-items:center; justify-content:center; color:white; z-index:2; box-shadow:0 1px 2px rgba(0,0,0,0.15);">
                  <svg viewBox="0 0 24 24" width="10" height="10" fill="white"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z"/></svg>
                </div>
              </div>

              <!-- Play/Pause Column -->
              <audio class="wa-chat-audio" src="${msg.audioUrl}" preload="metadata" style="display:none;"></audio>
              <button onclick="window.playCustomAudio(this)" style="background:transparent; border:none; width:24px; height:24px; display:flex; align-items:center; justify-content:center; cursor:pointer; flex-shrink:0; outline:none; padding:0;">
                <span class="wa-play-icon" style="color:${isMine ? 'white' : '#54656f'}; display:flex; align-items:center; justify-content:center;">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" style="display:block;"><path d="M8 5v14l11-7z"/></svg>
                </span>
              </button>

              <!-- Waveform + Metadata Column -->
              <div style="display:flex; flex-direction:column; gap:4px; flex:1; min-width:0;">
                <!-- Waveform Container -->
                <div class="wa-waveform-container" style="position:relative; width:100%; height:20px; display:flex; align-items:center;">
                  <!-- Waveform bars -->
                  <div class="wa-waveform-bars" style="display:flex; align-items:center; gap:2px; width:100%; height:100%;">
                    ${[10,14,12,8,6,10,14,18,22,16,12,8,10,14,20,24,18,14,10,8,12,16,20,14,10,6,8,12,16,10].map(h => `
                      <div class="wa-waveform-bar" style="flex:1; height:${h}px; background:${isMine ? 'rgba(255,255,255,0.25)' : '#b1b3b5'}; border-radius:1px; transition:background-color 0.1s;"></div>
                    `).join('')}
                  </div>
                  <!-- Handle/Thumb -->
                  <div class="wa-waveform-handle" style="position:absolute; width:10px; height:10px; border-radius:50%; background:#34b7f1; top:50%; transform:translate(-50%, -50%); left:0%; pointer-events:none; box-shadow:0 1px 3px rgba(0,0,0,0.25); transition:left 0.05s linear;"></div>
                  <!-- Hidden Input Range -->
                  <input type="range" class="wa-audio-seek" value="0" min="0" max="100" style="position:absolute; inset:0; width:100%; height:100%; opacity:0; cursor:pointer; z-index:10; margin:0; padding:0;">
                </div>

                <!-- Duration & Timestamp Row -->
                <div style="display:flex; justify-content:space-between; align-items:center; font-size:10.5px; color:${isMine ? '#a1a1aa' : '#667781'}; font-weight:700;">
                  <span class="wa-audio-time">0:00</span>
                  <div style="display:flex; align-items:center; gap:3px;">
                    <span>${timeStr}</span>
                    ${isMine ? ticksHtml : ''}
                  </div>
                </div>
              </div>
            </div>
          ` : `
            <div style="display:flex; flex-direction:column; gap:2px; min-width:60px;">
              <span class="bubble-text" style="word-break:break-word; padding-right:16px;">${escapeHtml(msg.text)}</span>
              <div style="display:flex; align-items:center; justify-content:flex-end; gap:3px; font-size:9.5px; color:${isMine ? '#a1a1aa' : '#9ca3af'}; font-weight:700; align-self:flex-end; margin-top:2px; margin-bottom:-4px; margin-right:-6px; opacity:0.85;">
                <span>${timeStr}</span>
                ${isMine ? ticksHtml : ''}
              </div>
            </div>
          `}
          ${reactionsHtml}
        </div>
        ${msg.type === 'image' ? `
          <div class="bubble-time-outside" style="display:inline-flex; align-items:center; gap:3px; font-size:10.5px; font-weight:750; color:var(--color-text-tertiary); margin-top:3px; padding:0 4px; ${isMine ? 'align-self:flex-end;' : 'align-self:flex-start;'}">
            <span>${timeStr}</span>
            ${isMine ? ticksHtml : ''}
          </div>
        ` : ''}
        ${seenTimeHtml}
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

function initReactionListeners(container, user, messagesRef, chatId) {
  let pressTimer = null;
  const cancelPress = () => {
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
  };

  if (container.dataset.reactionsInitialized === 'true') return;
  container.dataset.reactionsInitialized = 'true';

  container.addEventListener('touchstart', (e) => {
    const bubble = e.target.closest('.chat-bubble');
    if (!bubble) return;
    const msgId = bubble.dataset.msgId;
    if (!msgId) return;

    if (e.target.closest('.chat-bubble-reactions')) {
      showReactionMenu(e, bubble, msgId, user, messagesRef, chatId);
      return;
    }

    cancelPress();
    pressTimer = setTimeout(() => {
      showReactionMenu(e, bubble, msgId, user, messagesRef, chatId);
    }, 600);
  }, { passive: true });

  container.addEventListener('touchend', cancelPress, { passive: true });
  container.addEventListener('touchmove', cancelPress, { passive: true });

  container.addEventListener('click', (e) => {
    const rxBadge = e.target.closest('.chat-bubble-reactions');
    if (rxBadge) {
      const bubble = rxBadge.closest('.chat-bubble');
      const msgId = bubble?.dataset.msgId;
      if (bubble && msgId) {
        showReactionMenu(e, bubble, msgId, user, messagesRef, chatId);
      }
    }
  });

  container.addEventListener('contextmenu', (e) => {
    const bubble = e.target.closest('.chat-bubble');
    if (!bubble) return;
    e.preventDefault();
    const msgId = bubble.dataset.msgId;
    if (msgId) {
      showReactionMenu(e, bubble, msgId, user, messagesRef, chatId);
    }
  });
}

function showReactionMenu(event, bubble, msgId, user, messagesRef, chatId) {
  const existing = document.querySelector('.chat-reaction-menu');
  if (existing) existing.remove();

  const rect = bubble.getBoundingClientRect();
  const chatContainer = bubble.closest('.chat-container') || document.body;
  const containerRect = chatContainer.getBoundingClientRect();

  const menu = document.createElement('div');
  menu.className = 'chat-reaction-menu';
  
  const emojis = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
  menu.innerHTML = emojis.map(emo => `
    <span class="reaction-emoji-btn" style="font-size:22px; cursor:pointer; transition:transform 0.15s; user-select:none;" onmouseover="this.style.transform='scale(1.25)'" onmouseout="this.style.transform=''" data-emoji="${emo}">${emo}</span>
  `).join('');

  chatContainer.appendChild(menu);

  const menuWidth = 240;
  const leftPos = Math.max(10, Math.min(containerRect.width - menuWidth - 10, rect.left - containerRect.left + (rect.width - menuWidth) / 2));
  const topPos = rect.top - containerRect.top - 48;

  menu.style.cssText = `
    position: absolute;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 30px;
    padding: 6px 12px;
    display: flex;
    gap: 10px;
    box-shadow: 0 10px 30px rgba(0,0,0,0.25);
    z-index: 1000;
    left: ${leftPos}px;
    top: ${topPos}px;
    animation: popIn 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  `;

  menu.addEventListener('mousedown', ev => ev.stopPropagation());
  menu.addEventListener('touchstart', ev => ev.stopPropagation(), { passive: true });

  menu.querySelectorAll('.reaction-emoji-btn').forEach(btn => {
    btn.onclick = async () => {
      const emoji = btn.dataset.emoji;
      menu.remove();
      
      try {
        const { updateDoc, doc } = await import('firebase/firestore');
        const msgRef = doc(messagesRef, msgId);
        await updateDoc(msgRef, {
          [`reactions.${user.uid}`]: emoji
        });
      } catch (err) {
        console.error("Error setting reaction:", err);
      }
    };
  });

  const dismissMenu = () => {
    menu.remove();
    document.removeEventListener('click', dismissMenu);
    document.removeEventListener('touchstart', dismissMenu);
  };
  setTimeout(() => {
    document.addEventListener('click', dismissMenu);
    document.addEventListener('touchstart', dismissMenu, { passive: true });
  }, 100);
}
