// GoDelivery — In-App Chat Component (Real-Time via Firestore)
import { db } from '../firebase.js';
import { collection, doc, setDoc, addDoc, getDoc, getDocFromCache, onSnapshot, query, orderBy, serverTimestamp, updateDoc, arrayUnion, increment } from 'firebase/firestore';
import { isChatParty } from '../utils/chat-access.js';
import { getState } from '../state.js';
import { showModal, closeModal } from './modal.js';
import { registerUnsubscribe } from '../utils/cleanup.js';
import { icon } from '../utils/icons.js';
import { fitToVisibleViewport, autoGrowTextarea, keepFocusOnTap } from '../utils/keyboard-fit.js';
import { audioBubbleHtml, initAudioPlayers, analyzeWaveform } from './chat-audio.js';
import { initReactions, reactionPillHtml } from './chat-reactions.js';
import { goSharePlugin } from '../utils/share-receiver.js';

// Guards a double tap only. It used to stay true until the modal's onClose ran, so any early
// return in between (or a modal closed some other way) left every chat button dead until restart.
let lastOpenAt = 0;
let lastOpenKey = '';

// Who belongs in each chat. The chat with the driver is private: the shop is not a participant.
async function chatPartiesFor(type, orderData) {
  if (!orderData) return [];
  const parties = [];
  const shopOwner = async () => {
    if (orderData.comercioOwnerId) return orderData.comercioOwnerId;
    if (!orderData.comercioId) return null;
    try {
      const snap = await getDoc(doc(db, 'comercios', orderData.comercioId));
      return snap.exists() ? (snap.data().ownerId || null) : null;
    } catch (e) { return null; }
  };
  if (type === 'client-delivery') {
    parties.push(orderData.userId, orderData.driverId);
  } else if (type === 'client-commerce') {
    parties.push(orderData.userId, orderData.comercioId, await shopOwner());
  } else if (type === 'commerce-delivery') {
    parties.push(orderData.comercioId, await shopOwner(), orderData.driverId);
  }
  return [...new Set(parties.filter(Boolean))];
}

// The order as this phone has it (a driver's active order is always cached). If it doesn't, up to
// 800 ms from the server: after that the chat opens anyway and the rules still protect it.
async function orderWithoutWaiting(orderId) {
  const ref = doc(db, 'orders', orderId);
  try {
    const cached = await getDocFromCache(ref);
    if (cached.exists()) return cached.data();
  } catch (e) { /* not cached */ }
  const fromServer = getDoc(ref).then(s => (s.exists() ? s.data() : null)).catch(() => null);
  return Promise.race([fromServer, new Promise(resolve => setTimeout(() => resolve(null), 800))]);
}

// True when this chat must not open here: it belongs to other people, or the conversation
// happens on WhatsApp (bot orders: the customer has no app; an admin can still audit).
async function chatHandledElsewhere(order, { type, user, orderNum, isAdminUser }) {
  if (!isAdminUser && !isChatParty(type, order, user)) {
    const { showToast } = await import('./toast.js');
    showToast('Este chat es privado entre otras personas del pedido.', 'warning');
    return true;
  }
  if (type !== 'client-delivery' || order.source !== 'whatsapp_bot') return false;
  const { showToast } = await import('./toast.js');
  if (user.uid === order.userId) {
    showToast('Tu repartidor te escribe por WhatsApp si necesita algo.', 'info');
    return true;
  }
  const phone = String(order.waPhone || '').replace(/\D/g, '');
  if (phone) {
    const text = encodeURIComponent(`Hola ${order.userName || ''}, soy tu repartidor de GO! (pedido #${order.orderId || orderNum}).`.replace(/\s+/g, ' '));
    window.open(`https://wa.me/${phone}?text=${text}`, '_blank');
  } else {
    showToast('Este pedido es de WhatsApp y no tiene el número del cliente.', 'warning');
  }
  return true;
}

// The shop confirms the transfer receipt the customer sent. The button existed but this function
// didn't, so tapping it did nothing.
window.markAsPaid = async function(chatId, orderId, messageId) {
  const { showToast } = await import('./toast.js');
  try {
    await updateDoc(doc(db, 'chats', chatId, 'messages', messageId), { paidChecked: true });
    // Not paymentStatus: 'paid' is what Mercado Pago sets, and it notifies the shop of a new paid order.
    await updateDoc(doc(db, 'orders', orderId), { transferVerified: true });
    showToast('Pago marcado como recibido', 'success');
  } catch (err) {
    console.error('[chat] Could not mark as paid:', err);
    showToast('No se pudo marcar el pago. Revisá tu conexión y probá de nuevo.', 'error');
  }
};

/**
 * Opens a chat modal for a given order.
 */
export async function openChat(options) {
  const openKey = typeof options === 'string' ? options : `${options?.orderId}_${options?.type || 'client-delivery'}`;
  if (openKey === lastOpenKey && Date.now() - lastOpenAt < 1500) return;
  lastOpenKey = openKey;
  lastOpenAt = Date.now();

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
    return;
  }

  if (!orderId) {
    return;
  }

  const user = getState().user;
  if (!user) {
    return;
  }

  const { isAdmin } = await import('../auth.js');
  const isAdminUser = isAdmin();

  // This used to wait for the order from the server (twice) with nothing on screen, which with weak
  // signal looked like the chat wouldn't open. Now it takes what the phone already has, or waits
  // a moment; if the order arrives later, the same checks run again below.
  const knownOrder = isAudit ? null : await orderWithoutWaiting(orderId);
  if (knownOrder && await chatHandledElsewhere(knownOrder, { type, user, orderNum, isAdminUser })) return;

  const chatId = `${orderId}_${type}`;
  const chatRef = doc(db, 'chats', chatId);
  const messagesRef = collection(chatRef, 'messages');

  // Already on screen (a banner tapped while the same chat is open): nothing to do but the shared file.
  if (document.getElementById(`chat-messages-${chatId}`)) {
    if (options?.sharedFile) openChatLists.get(chatId)?.sendShared?.(options.sharedFile);
    return;
  }

  // Create the chat doc right away instead of after loading the order. Not awaited: offline the
  // write only resolves once the server has it, and the chat must open anyway.
  // An admin looking at someone else's chat stays out of participants: it would list it as theirs.
  const adminFromOutside = isAdminUser && !(knownOrder && isChatParty(type, knownOrder, user));
  const chatDocReady = isAudit ? Promise.resolve() : setDoc(chatRef, {
    orderId,
    type,
    ...(adminFromOutside ? {} : { participants: arrayUnion(user.uid) }),
    lastActivityAt: serverTimestamp(),
  }, { merge: true }).catch(err => console.warn('[chat] could not create chat doc yet:', err));

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
    <div class="go-page-header chat-header-bar"  style="background: var(--go-ink); color: white; border-radius: 0; padding: calc(14px + max(var(--safe-area-inset-top, 0px), env(safe-area-inset-top, 0px))) 16px 14px; display: flex; align-items: center; gap: 8px; border-bottom: 1px solid rgba(255,255,255,0.15); box-sizing: border-box;">
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
      <a id="chat-call-${chatId}" class="chat-call-btn" aria-label="Llamar" title="Llamar" hidden>${icon('phone', 20)}</a>
      <div id="chat-status-indicator-${chatId}"></div>
    </div>
    <div id="chat-offline-${chatId}" class="chat-offline-bar" ${navigator.onLine === false ? '' : 'hidden'}>Sin señal: tus mensajes salen solos cuando vuelva la conexión</div>
    <div id="chat-order-strip-${chatId}"></div>
    <div class="chat-messages" id="chat-messages-${chatId}">
      <div class="chat-loading" style="padding: 100px 0;">
        <div class="loader-dots"><span></span><span></span><span></span></div>
      </div>
    </div>
    <div id="chat-typing-indicator-${chatId}" class="chat-typing-wrapper" style="display:none;"></div>
    <div id="chat-footer-area-${chatId}" class="chat-footer-area">
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
      <div id="chat-reply-bar-${chatId}" class="chat-reply-bar" hidden></div>
      <div class="chat-input-bar" style="position:relative; width:100%; box-sizing:border-box;">
        <input type="file" id="chat-file-gallery-${chatId}" style="display:none" accept="image/*" multiple />
        <input type="file" id="chat-file-camera-${chatId}" style="display:none" accept="image/*" capture="environment" />
        <div class="chat-input-pill">
          <button class="chat-emoji-btn" id="emoji-btn-${chatId}" aria-label="Emojis">${icon('smile', 22)}</button>
          <textarea id="chat-input-${chatId}" class="chat-input" rows="1" placeholder="Escribí un mensaje..." autocomplete="off" enterkeyhint="send"></textarea>
          <button class="chat-more-btn" id="chat-more-${chatId}" aria-label="Ubicación o producto">${icon('paperclip', 21)}</button>
          <button class="chat-attach-btn" id="chat-attach-${chatId}" aria-label="Enviar foto">${icon('camera', 22)}</button>
        </div>
        
        <div id="chat-audio-indicator-${chatId}" style="display:none; position:absolute; inset:0; background:var(--color-surface); align-items:center; justify-content:space-between; padding:0 16px; border-radius:18px; z-index:50; border:1.5px solid var(--color-border);">
          <div style="display:flex; align-items:center; gap:8px;">
            <div class="recording-dot" style="width: 8px; height: 8px; background: #e11d48; border-radius: 50%; animation: pulse 1s infinite;"></div>
            <span id="chat-audio-timer-${chatId}" style="font-weight: 800; font-size: 14px; color:var(--color-text-primary); font-family:var(--font-display);">0:00</span>
          </div>
          <div id="chat-audio-slidehint-${chatId}" style="display:flex; align-items:center; gap:4px; position:absolute; right:125px; color: var(--color-text-primary); font-size: 13px; font-weight: 850; pointer-events:none; animation: slideHint 1.5s infinite; white-space:nowrap;">
            <span style="font-size:16px; margin-right:2px; font-weight:900;">‹</span> Desliza para cancelar
          </div>
        </div>

        <button class="chat-mic-btn" id="chat-mic-${chatId}" aria-label="Grabar audio" style="z-index:60; position:relative; touch-action:none; -webkit-user-select:none; user-select:none; -webkit-touch-callout:none;">${icon('mic', 22)}</button>
        <button class="chat-send-btn" id="chat-send-${chatId}" style="z-index:60; position:relative;">${icon('send', 20)}</button>
      </div>
    </div>
  `;

  let stopKeyboardFit = () => {};
  let stopAudio = () => {};
  let stopOfflineBar = () => {};
  let chatClosed = false;
  let latestMessages = [];
  const pendingUploads = [];
  const renderOptions = { chatId, orderId, chatType: type, isAudit, canMarkPaid: senderDisplayName === 'Comercio' };
  let retryTimer = null;

  const modalInstance = showModal({
    title: '',
    content: chatContainer,
    hideHeader: true,
    fullSwipe: false,
    height: '100dvh',
    fullscreen: true,
    slideFromRight: true,
    onClose: () => {
      chatClosed = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (unsub) unsub();
      if (orderUnsub) orderUnsub();
      if (chatDocUnsub) chatDocUnsub();
      if (otherUserUnsub) otherUserUnsub();
      stopAudio();
      stopOfflineBar();
      openChatLists.delete(chatId);
      updateRecordingStatus(chatRef, user.uid, false);
      document.querySelector('.chat-rx-layer')?.remove();
      stopKeyboardFit();
      updateTypingStatus(chatRef, user.uid, false);
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
  const refreshList = () => renderMessages(messagesContainer, latestMessages, user.uid, renderOptions, pendingUploads);
  const listState = { pendingUploads, refreshList, messagesContainer, orderId };
  setupInputListeners(chatId, messagesRef, user, chatRef, senderDisplayName, listState);
  openChatLists.set(chatId, listState);
  if (options?.sharedFile) listState.sendShared?.(options.sharedFile);

  const paintOffline = () => {
    const bar = document.getElementById(`chat-offline-${chatId}`);
    if (bar) bar.hidden = navigator.onLine !== false;
  };
  window.addEventListener('online', paintOffline);
  window.addEventListener('offline', paintOffline);
  stopOfflineBar = () => {
    window.removeEventListener('online', paintOffline);
    window.removeEventListener('offline', paintOffline);
  };

  stopAudio = initAudioPlayers(messagesContainer, {
    onPlayed: (id) => { if (!isAudit) updateDoc(doc(messagesRef, id), { played: true }).catch(() => {}); },
  });
  initReactions(messagesContainer, {
    uid: user.uid,
    messagesRef,
    getMessage: (id) => latestMessages.find(m => m.id === id && !m.deleted),
    isLocked: () => isAudit || !!document.getElementById(`chat-footer-area-${chatId}`)?.querySelector('.chat-closed-bar'),
    moreEmojis: [...new Set(Object.values(emojiCategories).flat())],
    onReply: (msg) => listState.startReply?.(msg),
    // No se borra: el texto queda para el admin (el chat sirve de registro ante un reclamo)
    onDelete: async (msg) => {
      try {
        await updateDoc(doc(messagesRef, msg.id), { deleted: true, deletedAt: serverTimestamp() });
        if (latestMessages[latestMessages.length - 1]?.id === msg.id) await updateDoc(chatRef, { lastMessage: '🚫 Mensaje eliminado' });
      } catch (err) {
        console.warn('[chat] delete', err);
        const { showToast } = await import('./toast.js');
        showToast('No se pudo eliminar. Revisá tu conexión.', 'warning');
      }
    },
  });

  // Con el teclado abierto el cuadro de texto queda siempre justo arriba (ver utils/keyboard-fit.js)
  stopKeyboardFit = fitToVisibleViewport(chatContainer, messagesContainer);

  // Real-time messages listener. A listener that errors is dead for good, and before this
  // nothing noticed: the chat stayed blank and "sending" looked broken. It is retried instead.
  const q = query(messagesRef, orderBy('timestamp', 'asc'));
  let isInitialLoad = true;
  let listenAttempts = 0;
  const onMessagesError = (err) => {
    console.warn('[chat] messages listener error:', err?.code || err);
    if (chatClosed) return;
    listenAttempts++;
    const delay = Math.min(1000 * 2 ** (listenAttempts - 1), 15000);
    retryTimer = setTimeout(async () => {
      if (chatClosed) return;
      await chatDocReady;
      if (!chatClosed) listenToMessages();
    }, delay);
    if (listenAttempts === 3) {
      messagesContainer.innerHTML = `<div class="chat-empty"><p>Reconectando el chat…</p><span>Revisá tu conexión. Los mensajes van a aparecer solos.</span></div>`;
    }
  };
  const listenToMessages = () => {
    if (unsub) unsub();
    unsub = onSnapshot(q, { includeMetadataChanges: true }, onMessagesSnapshot, onMessagesError);
    registerUnsubscribe(unsub);
  };
  const onMessagesSnapshot = (snap) => {
    listenAttempts = 0;
    latestMessages = snap.docs.map(d => ({ id: d.id, ...d.data(), pendingWrite: d.metadata?.hasPendingWrites === true }));

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

    refreshList();

    // Mark unread messages as read (not when an admin is only auditing: that would mark them
    // seen for the real recipient)
    let markedAny = false;
    if (!isAudit) snap.docs.forEach(d => {
      const msg = d.data();
      if (msg.senderId !== user.uid && !msg.read) {
        updateDoc(doc(messagesRef, d.id), { read: true, readAt: new Date().toISOString() }).catch(() => {});
        markedAny = true;
      }
    });
    if (markedAny) {
      updateDoc(chatRef, {
        [`unread.${user.uid}`]: 0
      }).catch(() => {});
    }
  };
  chatDocReady.then(() => {}, () => {});
  listenToMessages();

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
        if (!isAudit && !knownOrder && await chatHandledElsewhere(orderData, { type, user, orderNum, isAdminUser })) {
          closeModal();
          return;
        }
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

        listState.refreshCall = (o) => showCall('', o);
        const paintStrip = (o) => renderOrderStrip(chatId, o, { user, type, isAudit, list: listState });
        paintStrip(orderData);

        // Llamar a la otra parte, mientras el pedido esté en curso
        let lastPhone = '';
        const showCall = (rawPhone, current = orderData) => {
          const phone = String(rawPhone || lastPhone || '').replace(/[^\d+]/g, '');
          lastPhone = phone;
          const callBtn = document.getElementById(`chat-call-${chatId}`);
          if (!callBtn || !phone || isReadOnly) return;
          // El cliente no llama al repartidor: se escriben por acá (cuida su número)
          if (type === 'client-delivery' && user.uid === current.userId) return;
          callBtn.href = `tel:${phone}`;
          callBtn.hidden = false;
        };
        const clientPhone = orderData.userPhone || orderData.clientPhone || orderData.phone;
        const iAmClient = user.uid === orderData.userId;
        const iAmDriver = user.uid === orderData.driverId;
        if (type === 'client-delivery') showCall(iAmClient ? orderData.driverPhone : clientPhone);
        else if (type === 'client-commerce') showCall(iAmClient ? orderData.comercioPhone : clientPhone);
        else if (type === 'commerce-delivery') showCall(iAmDriver ? orderData.comercioPhone : orderData.driverPhone);

        if (otherId) {
          otherUserUnsub = onSnapshot(doc(db, 'users', otherId), async (uSnap) => {
            if (uSnap.exists()) {
              const uData = uSnap.data();
              let photo = uData.photoURL || uData.profilePhoto || null;
              // El pedido no siempre trae el teléfono de la otra parte
              if (document.getElementById(`chat-call-${chatId}`)?.hidden) showCall(uData.phone || uData.phoneNumber);
              
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

        if (!isReadOnly && type === 'client-delivery' && orderData.driverId === user.uid) showQuickReplies(chatId, stripIsTransfer(orderData));

        // 2. Add every party of the chat, so each one sees it in their list and gets the
        // in-app alert (not awaited: offline it would hold up the rest of the setup)
        if (!isAudit) {
          const parts = [user.uid, ...(await chatPartiesFor(type, orderData))];
          setDoc(chatRef, {
            orderId,
            type,
            participants: arrayUnion(...parts),
            unread: { [user.uid]: 0 },
          }, { merge: true }).catch(err => console.warn('[chat] participants update failed:', err));
        }
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
          renderOrderStrip(chatId, snap.data(), { user, type, isAudit, list: listState });
          listState.refreshCall?.(snap.data());
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
        const otherIsRecording = Object.entries(data.recording || {}).some(([uid, on]) => uid !== user.uid && on);
        const whoIsThere = chatContainer.querySelector('.chat-header-name')?.childNodes[0]?.textContent || otherName;
        showTypingIndicator(chatId, otherIsTyping || otherIsRecording, whoIsThere, otherIsRecording ? 'está grabando un audio' : 'está escribiendo');
      }, err => console.warn('[chat] typing listener error:', err?.code || err));
      registerUnsubscribe(chatDocUnsub);
    } catch (e) {
      console.error('Chat background init error:', e);
    }
  })();

  // Delegated listener for Lightbox
  messagesContainer.addEventListener('click', (e) => {
    const quote = e.target.closest('.chat-quote');
    if (quote) {
      const target = messagesContainer.querySelector(`[data-msg-id="${CSS.escape(quote.dataset.replyTo)}"]`);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.classList.add('chat-flash');
        setTimeout(() => target.classList.remove('chat-flash'), 1200);
      }
      return;
    }
    const imgContainer = e.target.closest('.chat-image-container');
    if (imgContainer?.classList.contains('has-failed')) {
      const img = imgContainer.querySelector('img');
      imgContainer.classList.remove('has-failed');
      if (img) img.src = imgContainer.dataset.url;
      return;
    }
    if (imgContainer && !imgContainer.classList.contains('is-pending') && imgContainer.dataset.url && imgContainer.dataset.url !== 'undefined') {
      window.openLightbox(imgContainer.dataset.url);
    }
  });
}

// Lo que más escribe un repartidor, a un toque (va en moto)
const QUICK_REPLIES = ['Ya llegué 👋', 'Estoy en camino 🛵', 'Estoy afuera', 'No hay este producto', '¿Te llevo otro parecido?', '¿Me pasás la altura exacta?'];

function showQuickReplies(chatId, isTransfer = false) {
  const bar = document.getElementById(`chat-footer-area-${chatId}`)?.querySelector('.chat-input-bar');
  if (!bar || bar.previousElementSibling?.classList.contains('chat-quick-replies')) return;
  bar.insertAdjacentHTML('beforebegin', `<div class="chat-quick-replies">${(isTransfer ? ['¿Me mandás el comprobante?', ...QUICK_REPLIES] : QUICK_REPLIES).map(t => `<button type="button" class="quick-pill-btn">${t}</button>`).join('')}</div>`);
}

// Chat list preview + per-person unread counters. The push and the in-app notification for the
// recipients come from the server (onNewChatMessage in functions/index.js).
async function updateChatMetadata(chatRef, uid, lastMessageText) {
  try {
    const [orderId, ...typeParts] = chatRef.id.split('_');
    const chatType = typeParts.join('_');
    let parties = [];
    try {
      const orderSnap = await getDoc(doc(db, 'orders', orderId));
      if (orderSnap.exists()) parties = await chatPartiesFor(chatType, orderSnap.data());
    } catch (err) {
      console.warn('Failed to fetch order for chat metadata:', err);
    }

    // A nested map: setDoc does not read dotted keys as paths, so `unread.<uid>` used to land in
    // literal top-level fields that nothing reads, and the real counters never went up.
    const unread = { [uid]: 0 };
    parties.filter(p => p !== uid).forEach(p => { unread[p] = increment(1); });

    const { isAdmin } = await import('../auth.js');
    // The sender (a shop manager isn't in `parties`), except an admin writing in someone else's chat.
    const listed = isAdmin() && parties.length ? parties : [uid, ...parties];

    await setDoc(chatRef, {
      orderId,
      type: chatType,
      participants: arrayUnion(...listed),
      lastMessage: lastMessageText,
      lastMessageAt: serverTimestamp(),
      lastActivityAt: serverTimestamp(),
      unread,
    }, { merge: true });
  } catch (e) {
    console.error("Error updating chat metadata:", e);
  }
}

const openChatLists = new Map();
const MAX_IMAGES_AT_ONCE = 5;
const IMAGE_MAX_SIDE = 1600;
const localImagePreviews = new Map();

// Foto lista para mandar: como mucho 1600 px, y una miniatura mínima que se ve mientras baja la
// original (con sus medidas la burbuja ya tiene su tamaño y la lista no salta). Si el celular no
// puede abrirla (formato raro), va tal cual.
async function prepareChatImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = url;
    });
    const w = img.naturalWidth, h = img.naturalHeight;
    const draw = (side, quality) => new Promise((resolve) => {
      const k = Math.min(1, side / Math.max(w, h));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w * k));
      c.height = Math.max(1, Math.round(h * k));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      c.toBlob(resolve, 'image/jpeg', quality);
    });
    const [big, small] = await Promise.all([draw(IMAGE_MAX_SIDE, 0.82), draw(24, 0.5)]);
    const thumb = small ? await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => resolve(null);
      r.readAsDataURL(small);
    }) : null;
    const k = Math.min(1, IMAGE_MAX_SIDE / Math.max(w, h));
    const useBig = big && (big.size < file.size || k < 1 || file.type !== 'image/jpeg');
    return {
      file: useBig ? new File([big], 'foto.jpg', { type: 'image/jpeg' }) : file,
      width: Math.round(w * k),
      height: Math.round(h * k),
      thumb,
    };
  } catch (e) {
    return { file, width: 0, height: 0, thumb: null };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function setupInputListeners(chatId, messagesRef, user, chatRef, senderDisplayName, list) {
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
    if (isRecording) updateRecordingStatus(chatRef, user.uid, false);
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
        updateRecordingStatus(chatRef, user.uid, true);
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
             
             // La forma del audio no vale la demora: si tarda, va sin ella
             const waveform = await Promise.race([analyzeWaveform(audioBlob), new Promise(r => setTimeout(() => r(null), 1500))]);
             await uploadBytes(storageRef, audioBlob, { contentType: finalMime.split(';')[0] });
             const downloadURL = await getDownloadURL(storageRef);
             
              await addDoc(messagesRef, {
                 senderId: user.uid,
                 senderName: displayName,
                 senderPhoto: user.photoURL || user.profilePhoto || null,
                 text: 'Mensaje de voz',
                 type: 'audio',
                 audioUrl: downloadURL,
                 duration: Math.round(elapsedMs / 1000),
                 ...takeReply(),
                 ...(waveform ? { waveform } : {}),
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
      input.dispatchEvent(new Event('input')); // agranda el cuadro si hace falta
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
      .chat-emoji-picker-v2 { position: absolute; bottom: calc(100% + 8px); left: 10px; right: 10px; height: 320px; background: var(--glass-bg); backdrop-filter: var(--glass-blur); border-radius: 24px; border: 1px solid var(--glass-border); box-shadow: var(--shadow-lg); display: flex; flex-direction: column; z-index: 1000; animation: emoji-slide-up 0.3s cubic-bezier(0.4, 0, 0.2, 1); overflow: hidden; }
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

  // Responder a un mensaje: queda arriba del cuadro hasta mandar el próximo
  let replyTo = null;
  const replyBar = document.getElementById(`chat-reply-bar-${chatId}`);
  const showReply = () => {
    if (!replyBar) return;
    replyBar.hidden = !replyTo;
    replyBar.innerHTML = replyTo ? `
      <div class="chat-reply-text"><b>${escapeHtml(replyTo.senderName || 'Mensaje')}</b><span>${escapeHtml(replyTo.preview)}</span></div>
      <button type="button" class="chat-reply-close" aria-label="Cancelar respuesta">${icon('close', 16)}</button>` : '';
  };
  list.startReply = (msg) => {
    replyTo = { id: msg.id, senderName: msg.senderName || '', preview: messagePreview(msg).slice(0, 120) };
    showReply();
    input?.focus();
  };
  const takeReply = () => {
    const r = replyTo;
    replyTo = null;
    showReply();
    return r ? { replyTo: r } : {};
  };
  replyBar?.addEventListener('click', (e) => {
    if (e.target.closest('.chat-reply-close')) { replyTo = null; showReply(); }
  });
  input.closest('.chat-footer-area')?.addEventListener('click', (e) => {
    const quick = e.target.closest('.quick-pill-btn');
    if (!quick) return;
    input.value = quick.textContent;
    sendBtn.click();
  });

  const sendSpecial = async (fields, preview) => {
    if (isChatClosed()) return;
    try {
      await addDoc(messagesRef, {
        senderId: user.uid,
        senderName: displayName,
        senderPhoto: user.photoURL || user.profilePhoto || null,
        timestamp: serverTimestamp(),
        read: false,
        ...takeReply(),
        ...fields,
      });
      await updateChatMetadata(chatRef, user.uid, preview);
    } catch (err) {
      console.error('Error sending message:', err);
      import('./toast.js').then(m => m.showToast('No se pudo enviar. Probá de nuevo.', 'error'));
    }
  };

  const shareLocation = async () => {
    const { showToast } = await import('./toast.js');
    showToast('Buscando tu ubicación…', 'info');
    try {
      const options = { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 };
      const isNative = window.Capacitor?.getPlatform && window.Capacitor.getPlatform() !== 'web';
      const read = isNative
        ? import('@capacitor/geolocation').then(m => m.Geolocation.getCurrentPosition(options))
        : new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, options));
      // El WebView a veces nunca responde: con tope propio (ver "Iniciar Jornada")
      const pos = await Promise.race([read, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 12000))]);
      await sendSpecial({ type: 'location', text: '📍 Ubicación', lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy || 0) }, '📍 Ubicación');
    } catch (err) {
      showToast('No pudimos leer tu ubicación. Revisá el permiso y el GPS.', 'warning');
    }
  };

  const pickProduct = async () => {
    const { showToast } = await import('./toast.js');
    let items = [];
    try {
      const snap = await getDoc(doc(db, 'orders', list.orderId));
      items = (snap.data()?.items || []).filter(i => i.name && Number(i.qty ?? 1) > 0);
    } catch (err) { /* sin datos: se avisa abajo */ }
    if (!items.length) { showToast('Este pedido no tiene productos para elegir.', 'info'); return; }
    showModal({
      title: 'Elegí un producto',
      height: 'auto',
      content: `<div class="chat-product-list" style="padding-bottom:calc(16px + env(safe-area-inset-bottom));">${items.map((it, i) => `
        <button type="button" class="chat-product-row" data-i="${i}">
          ${it.image ? `<img src="${escapeHtml(it.image)}" alt="" loading="lazy">` : `<span class="chat-product-noimg">${icon('shoppingBag', 20)}</span>`}
          <span>${escapeHtml(it.name)}</span>
        </button>`).join('')}</div>`,
      onOpen: () => {
        document.querySelectorAll('.chat-product-row').forEach(btn => {
          btn.onclick = () => {
            const it = items[Number(btn.dataset.i)];
            closeModal();
            sendSpecial({
              type: 'product',
              text: `🛒 ${it.name}`,
              product: { name: it.name, image: it.image || null, price: Number(it.price) || 0 },
            }, `🛒 ${it.name}`);
          };
        });
      },
    });
  };
  // Only this chat's footer counts: another chat closing on screen must not block this one.
  const isChatClosed = () => !!document.getElementById(`chat-footer-area-${chatId}`)?.querySelector('.chat-closed-bar');

  document.getElementById(`chat-more-${chatId}`)?.addEventListener('click', () => {
    const row = (id, name, label) => `<button id="${id}" class="chat-more-option">${icon(name, 20)} ${label}</button>`;
    showModal({
      title: 'Enviar',
      height: 'auto',
      content: `<div class="chat-more-sheet" style="padding-bottom:calc(20px + max(var(--safe-area-inset-bottom, 0px), env(safe-area-inset-bottom, 0px)));">
        ${row(`btn-use-location-${chatId}`, 'mapPin', 'Mi ubicación')}
        ${row(`btn-use-product-${chatId}`, 'shoppingBag', 'Producto del pedido')}
      </div>`,
      onOpen: () => {
        document.getElementById(`btn-use-location-${chatId}`).onclick = () => { closeModal(); shareLocation(); };
        document.getElementById(`btn-use-product-${chatId}`).onclick = () => { closeModal(); pickProduct(); };
      },
    });
  });

  attachBtn?.addEventListener('click', () => {
    showModal({
      title: 'Enviar foto',
      content: `
        <div style="padding: 24px 20px calc(24px + max(var(--safe-area-inset-bottom, 0px), env(safe-area-inset-bottom, 0px))) 20px; display: flex; flex-direction: column; gap: 16px;">
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
                askCaption(file);
              } else {
                fileInputCamera?.click();
              }
            } catch (err) {
              if (/cancel/i.test(err?.message || '')) return;
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

  // La foto se ve al instante con su avance; el mensaje recién se crea cuando ya está subida, así la
  // otra persona no recibe un aviso de una foto que todavía no puede ver.
  const setUploadProgress = (id, pct) => {
    const el = list.messagesContainer.querySelector(`[data-upload-id="${id}"]`);
    if (!el) return;
    const label = el.querySelector('.chat-upload-pct');
    if (label) label.textContent = `${pct}%`;
    el.querySelector('.chat-upload-ring')?.style.setProperty('--pct', pct);
  };

  const uploadImage = async (item) => {
    item.status = 'uploading';
    item.progress = 0;
    list.refreshList();
    try {
      const { ref, uploadBytesResumable, getDownloadURL } = await import('firebase/storage');
      const { storage } = await import('../firebase.js');
      const fileRef = ref(storage, `chats/${chatId}/${Date.now()}_${item.id}.${item.isPdf ? 'pdf' : 'jpg'}`);
      const task = uploadBytesResumable(fileRef, item.prepared.file, { contentType: item.prepared.file.type || 'image/jpeg' });
      await new Promise((resolve, reject) => {
        task.on('state_changed', (snap) => {
          item.progress = snap.totalBytes ? Math.round((snap.bytesTransferred / snap.totalBytes) * 100) : 0;
          setUploadProgress(item.id, item.progress);
        }, reject, resolve);
      });
      const url = await getDownloadURL(fileRef);
      // Quien la mandó sigue viendo la copia del celular: no se vuelve a bajar lo que ya tiene
      if (!item.isPdf) localImagePreviews.set(url, item.previewUrl);
      await addDoc(messagesRef, {
        senderId: user.uid,
        senderName: displayName,
        senderPhoto: user.photoURL || user.profilePhoto || null,
        text: item.isPdf ? `📄 ${item.fileName}` : '',
        type: item.isPdf ? 'file' : 'image',
        status: 'ready',
        ...(item.isPdf ? { fileUrl: url, fileName: item.fileName } : { imageUrl: url }),
        ...(item.prepared.width ? { width: item.prepared.width, height: item.prepared.height } : {}),
        ...(item.prepared.thumb ? { thumb: item.prepared.thumb } : {}),
        ...(item.caption ? { caption: item.caption } : {}),
        ...(item.viaShare ? { viaShare: true } : {}),
        ...item.reply,
        timestamp: serverTimestamp(),
        read: false,
      });
      list.pendingUploads.splice(list.pendingUploads.indexOf(item), 1);
      list.refreshList();
      await updateChatMetadata(chatRef, user.uid, item.isPdf ? `📄 ${item.fileName}` : (item.caption ? `📷 ${item.caption}` : '📷 Foto'));
    } catch (err) {
      console.error('Upload error:', err);
      item.status = 'error';
      list.refreshList();
    }
  };

  // Una foto: se ve antes de mandarla y se le puede escribir algo
  const askCaption = (file) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    let sent = false;
    showModal({
      title: 'Enviar foto',
      height: 'auto',
      content: `
        <div class="chat-caption-sheet" style="padding-bottom:calc(16px + env(safe-area-inset-bottom));">
          <img src="${url}" alt="">
          <div class="chat-caption-row">
            <input type="text" id="chat-caption-${chatId}" class="chat-caption-input" placeholder="Agregá un comentario…" maxlength="500" enterkeyhint="send">
            <button type="button" id="chat-caption-send-${chatId}" class="chat-caption-send" aria-label="Enviar">${icon('send', 20)}</button>
          </div>
        </div>`,
      onClose: () => { if (!sent) URL.revokeObjectURL(url); },
      onOpen: () => {
        const field = document.getElementById(`chat-caption-${chatId}`);
        const go = () => {
          if (sent) return;
          sent = true;
          const caption = field.value.trim();
          closeModal();
          handleFileSelect(file, caption);
        };
        document.getElementById(`chat-caption-send-${chatId}`).onclick = go;
        field.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
      },
    });
  };

  const handleFileSelect = async (rawFile, caption = '', viaShare = false) => {
    if (!rawFile) return;
    if (isChatClosed()) {
      import('./toast.js').then(m => m.showToast('El chat ha finalizado. No podés enviar mensajes.', 'warning'));
      return;
    }
    import('../utils/audio-manager.js').then(m => {
      m.AudioManager.playSynthMessageSend();
    });
    const item = {
      id: `u${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      previewUrl: URL.createObjectURL(rawFile),
      isPdf: rawFile.type === 'application/pdf',
      fileName: String(rawFile.name || 'comprobante.pdf').slice(0, 120),
      status: 'preparing',
      progress: 0,
      caption,
      viaShare,
      reply: takeReply(),
    };
    list.pendingUploads.push(item);
    list.refreshList();
    item.isPdf = rawFile.type === 'application/pdf';
    item.fileName = String(rawFile.name || 'comprobante.pdf').slice(0, 120);
    item.prepared = item.isPdf ? { file: rawFile } : await prepareChatImage(rawFile);
    item.width = item.prepared.width;
    item.height = item.prepared.height;
    await uploadImage(item);
  };

  list.messagesContainer.addEventListener('click', (e) => {
    const box = e.target.closest('[data-upload-id]');
    if (!box) return;
    const item = list.pendingUploads.find(u => u.id === box.dataset.uploadId);
    if (!item || item.status !== 'error') return;
    if (e.target.closest('.chat-upload-discard')) {
      list.pendingUploads.splice(list.pendingUploads.indexOf(item), 1);
      URL.revokeObjectURL(item.previewUrl);
      list.refreshList();
    } else if (e.target.closest('.chat-upload-retry')) {
      uploadImage(item);
    }
  });

  // The picker sheet was already closed by its own buttons; closing again here closed the chat.
  let receiptNext = false;
  const RECEIPT_CAPTION = '🧾 Comprobante de transferencia';
  list.pickReceipt = () => {
    receiptNext = true;
    if (fileInputGallery) fileInputGallery.accept = 'image/*,application/pdf';
    fileInputGallery?.click();
  };
  // Lo que llega compartido desde otra app (src/utils/share-receiver.js)
  list.sendShared = (file) => handleFileSelect(file, RECEIPT_CAPTION, true);
  const onFilesPicked = (e) => {
    const files = Array.from(e.target.files || []).slice(0, MAX_IMAGES_AT_ONCE);
    e.target.value = '';
    if (receiptNext) {
      receiptNext = false;
      if (fileInputGallery) fileInputGallery.accept = 'image/*';
      if (files[0]) handleFileSelect(files[0], RECEIPT_CAPTION);
      return;
    }
    if (files.length === 1) askCaption(files[0]);
    else files.forEach(f => handleFileSelect(f));
  };
  fileInputGallery?.addEventListener('change', onFilesPicked);
  fileInputCamera?.addEventListener('change', onFilesPicked);

  // El cuadro crece con el texto (antes era de una sola línea y un mensaje largo se corría hacia el
  // costado sin que se viera lo escrito), y tocar enviar no cierra el teclado.
  const autoGrow = autoGrowTextarea(input);
  keepFocusOnTap(input, sendBtn, micBtn);

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
    if (isChatClosed()) {
      import('./toast.js').then(m => m.showToast('El chat ha finalizado. No podés enviar mensajes.', 'warning'));
      return;
    }

    input.value = '';
    autoGrow();
    input.focus();
    const reply = takeReply();

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
        ...reply,
      });

      await updateChatMetadata(chatRef, user.uid, text);
    } catch (err) {
      console.error('Error sending message:', err);
      if (!input.value) { input.value = text; autoGrow(); }
      import('./toast.js').then(m => m.showToast('No se pudo enviar el mensaje. Probá de nuevo.', 'error'));
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

// Las medidas de la foto, con un límite para que una muy larga no ocupe toda la pantalla
const imageRatio = (w, h) => (w > 0 && h > 0 ? Math.max(0.62, Math.min(1.6, w / h)) : 1);

// Cómo compartir el comprobante: el paso 3 cambia porque en iPhone hay que volver a abrir GO!
function showShareHelp() {
  const iPhone = window.Capacitor?.getPlatform?.() === 'ios';
  const steps = [
    ['copy', 'Copiá el alias y transferí', 'Desde Mercado Pago o tu billetera.'],
    ['send', 'Tocá Compartir en el comprobante', 'Es el botón que aparece al terminar la transferencia.'],
    ['check', iPhone ? 'Elegí GO! y volvé a abrir la app' : 'Elegí GO!', iPhone ? 'Se manda solo al chat de tu pedido. Si no lo ves, tocá Más en la lista.' : 'Se manda solo al chat de tu pedido.'],
  ];
  showModal({
    title: 'Mandar el comprobante',
    height: 'auto',
    content: `<div class="chat-share-help" style="padding-bottom:calc(20px + env(safe-area-inset-bottom));">${steps.map(([name, title, sub], i) => `
      <div class="chat-share-step"><span>${i + 1}</span><div><b>${title}</b><small>${sub}</small></div>${icon(name, 20)}</div>`).join('')}</div>`,
  });
}

const stripMoney = (n) => `$ ${Math.round(Number(n) || 0).toLocaleString('es-AR')}`;
const stripIsTransfer = (o) => { const pm = String(o.paymentMethod || '').toLowerCase(); return pm === 'mercadopago' || pm.includes('transf'); };

// Arriba de la conversación: qué se pidió y cuánto es, sin salir del chat. Al cliente que paga con
// transferencia, además el alias y el monto para copiar y mandar el comprobante acá mismo.
function renderOrderStrip(chatId, order, { user, type, isAudit, list }) {
  const box = document.getElementById(`chat-order-strip-${chatId}`);
  if (!box) return;
  const items = (Array.isArray(order.items) ? order.items : []).filter(i => Number(i.qty ?? i.quantity ?? 1) > 0);
  const finished = ['completed', 'delivered', 'cancelled'].includes(order.status);
  const pay = stripIsTransfer(order) ? 'Transferencia' : 'Efectivo';
  const qty = items.reduce((sum, i) => sum + (Number(i.qty ?? i.quantity) || 1), 0);
  const what = qty ? `${qty} producto${qty === 1 ? '' : 's'}` : (order.isTrip ? 'Viaje' : 'Mandado');
  const total = Number(order.totalAmount || order.total) || 0;
  const list_ = items.length
    ? items.map(i => `
        <div class="chat-strip-item">
          ${i.image ? `<img src="${escapeHtml(i.image)}" alt="" loading="lazy">` : ''}
          <span>${escapeHtml(i.qty ?? i.quantity ?? 1)} × ${escapeHtml(i.name || i.title || 'Producto')}</span>
          <b>${stripMoney((Number(i.price) || 0) * (Number(i.qty ?? i.quantity) || 1))}</b>
        </div>`).join('')
    : `<div class="chat-strip-item"><span>${escapeHtml(order.details || order.description || 'Sin detalle')}</span></div>`;
  const showPay = !isAudit && !finished && type === 'client-delivery' && user.uid === order.userId && stripIsTransfer(order) && order.driverAlias;
  const html = `
    <details class="chat-order-strip">
      <summary>
        <span>${what}${total ? ` · ${stripMoney(total)}` : ''} · ${pay}</span>
        ${icon('chevronDown', 18)}
      </summary>
      <div class="chat-strip-list">${list_}</div>
    </details>
    ${showPay ? `
      <div class="chat-pay-card">
        <div><small>Transferí ${stripMoney(total)} al alias</small><b>${escapeHtml(order.driverAlias)}</b></div>
        <button type="button" class="chat-pay-copy" data-alias="${escapeHtml(order.driverAlias)}">${icon('copy', 15)} Copiar</button>
        <button type="button" class="chat-pay-receipt">${icon('image', 15)} Comprobante</button>
        ${goSharePlugin() ? `<button type="button" class="chat-pay-how">¿Ya transferiste? Compartilo desde tu billetera eligiendo <b>GO!</b> <u>Ver cómo</u></button>` : ''}
      </div>` : ''}`;
  if (box.dataset.html === html) return;
  const wasOpen = box.querySelector('details')?.open;
  box.dataset.html = html;
  box.innerHTML = html;
  if (wasOpen) box.querySelector('details').open = true;
  box.onclick = async (e) => {
    const copy = e.target.closest('.chat-pay-copy');
    if (copy) {
      const { showToast } = await import('./toast.js');
      try { await navigator.clipboard.writeText(copy.dataset.alias); showToast(goSharePlugin() ? 'Alias copiado. Al terminar, compartí el comprobante a GO! desde tu billetera.' : 'Alias copiado', 'success'); } catch (err) { showToast('No se pudo copiar. Alias: ' + copy.dataset.alias, 'info'); }
      return;
    }
    if (e.target.closest('.chat-pay-how')) { showShareHelp(); return; }
    if (e.target.closest('.chat-pay-receipt')) list.pickReceipt?.();
  };
}

const messagePreview = (m) => (m.type === 'image' ? (m.caption ? `📷 ${m.caption}` : '📷 Foto') : m.type === 'audio' ? '🎤 Mensaje de voz' : (m.text || 'Mensaje'));

const quoteHtml = (m) => (m.replyTo ? `
  <button type="button" class="chat-quote" data-reply-to="${escapeHtml(m.replyTo.id)}">
    <b>${escapeHtml(m.replyTo.senderName || 'Mensaje')}</b>
    <span>${escapeHtml(m.replyTo.preview)}</span>
  </button>` : '');

function pendingUploadHtml(u) {
  return `
    <div class="chat-bubble-row is-mine">
      <div class="chat-bubble bubble-mine bubble-image">
        <div class="chat-image-container is-pending" data-upload-id="${u.id}" style="aspect-ratio:${u.isPdf ? 1.6 : imageRatio(u.width, u.height)};">
          ${u.isPdf ? `<div class="chat-file-pending">${icon('fileText', 28)}<span>${escapeHtml(u.fileName)}</span></div>` : `<img src="${u.previewUrl}" class="chat-img is-loaded" alt="">`}
          ${u.status === 'error' ? `
            <div class="img-loader-overlay is-error">
              ${icon('alertCircle', 24)}
              <span>No se pudo enviar</span>
              <div class="chat-upload-actions">
                <button type="button" class="chat-upload-retry">Reintentar</button>
                <button type="button" class="chat-upload-discard">Descartar</button>
              </div>
            </div>` : `
            <div class="img-loader-overlay">
              <div class="chat-upload-ring" style="--pct:${u.progress || 0};"><span class="chat-upload-pct">${u.progress || 0}%</span></div>
            </div>`}
        </div>
      </div>
    </div>`;
}

function renderMessages(container, messages, currentUserId, { chatId, orderId, chatType, isAudit = false, canMarkPaid = false } = {}, pending = []) {
  if (messages.length === 0 && pending.length === 0) {
    container._rows = null;
    container.innerHTML = `
      <div class="chat-empty">
        ${icon('chatBubble', 48)}
        <p>Iniciá la conversación</p>
        <span>Los chats quedan guardados y pueden revisarse si hay un reclamo</span>
      </div>
    `;
    return;
  }

  let html = '';
  let lastDate = '';
  const rows = [];

  // Determine alignment in audit mode: first sender on left, second sender on right
  const firstSenderId = messages.find(m => m.senderId && m.senderId !== 'system')?.senderId;

  messages.forEach((original, index) => {
    html = '';
    const msg = original.deleted && !isAudit
      ? { id: original.id, senderId: original.senderId, senderName: original.senderName, timestamp: original.timestamp, read: original.read, type: 'text', text: '🚫 Mensaje eliminado', isDeletedView: true }
      : original;
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

      if (msg.status === 'sending' || !msg.timestamp || (msg.pendingWrite && !msg.read)) {
        // Todavía en este celular: se envía solo cuando haya señal
        ticksHtml = `<span class="chat-tick" title="Enviando" style="display:inline-flex; align-items:center; vertical-align:middle; line-height:1;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="opacity:.7"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg></span>`;
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
      html += `<div class="chat-system-msg"><span>${escapeHtml(msg.text)}</span></div>`;
      rows.push({ key: msg.id, html });
      return;
    }

    const showBubbleName = isAudit ? (!isConsecutive && msg.senderName) : (!isMine && !isConsecutive);

    const reactionsHtml = reactionPillHtml(msg.reactions, currentUserId);

    html += `
      <div class="chat-bubble-row ${isMine ? 'is-mine' : 'is-other'} ${isConsecutive ? 'consecutive' : ''} ${reactionsHtml ? 'has-reactions' : ''}">
        ${showBubbleName ? `<div class="chat-bubble-name">${escapeHtml(msg.senderName)}</div>` : ''}
        <div class="chat-bubble ${isMine ? 'bubble-mine' : 'bubble-other'} ${msg.type === 'image' ? 'bubble-image' : ''} ${msg.type === 'audio' ? 'bubble-audio' : ''}" data-msg-id="${msg.id}" style="position:relative;">
          ${original.deleted && isAudit ? '<div class="chat-deleted-tag">Lo eliminó quien lo escribió</div>' : ''}
          ${quoteHtml(msg)}
          ${msg.type === 'image' ? `
            <div class="chat-image-container ${msg.status === 'uploading' || msg.status === 'error' || !msg.imageUrl ? 'is-pending' : ''}" data-url="${escapeHtml(msg.imageUrl)}" style="aspect-ratio:${imageRatio(msg.width, msg.height)};${msg.thumb ? ` background-image:url('${escapeHtml(msg.thumb)}');` : ''}">
              ${msg.imageUrl ? `<img src="${escapeHtml(localImagePreviews.get(msg.imageUrl) || msg.imageUrl)}" class="chat-img" alt="Foto" loading="lazy" decoding="async">` : ''}
              ${msg.status === 'uploading' ? `
                <div class="img-loader-overlay">
                  <div class="spinner-small"></div>
                  <span>Subiendo…</span>
                </div>
              ` : msg.status === 'error' || !msg.imageUrl ? `
                <div class="img-loader-overlay is-error">
                  ${icon('alertCircle', 24)}
                  <span>No se pudo enviar la foto</span>
                </div>
              ` : `
                <div class="chat-img-failed">${icon('alertCircle', 20)}<span>Tocá para volver a cargar</span></div>
                <div class="bubble-time"><span>${timeStr}</span>${isMine ? ticksHtml : ''}</div>
              `}
            </div>
          ${msg.caption ? `<div class="chat-img-caption">${escapeHtml(msg.caption)}</div>` : ''}
          ` : msg.type === 'file' && /^https?:\/\//.test(msg.fileUrl || '') ? `
            <a class="chat-location" href="${escapeHtml(msg.fileUrl)}" target="_blank" rel="noopener noreferrer">
              <span class="chat-location-icon">${icon('fileText', 22)}</span>
              <span style="min-width:0; overflow-wrap:anywhere;"><b>${escapeHtml(msg.fileName || 'Archivo')}</b><small>Abrir PDF</small></span>
            </a>
            <div class="chat-card-time"><span>${timeStr}</span>${isMine ? ticksHtml : ''}</div>
          ` : msg.type === 'location' && Number.isFinite(Number(msg.lat)) && Number.isFinite(Number(msg.lng)) ? `
            <a class="chat-location" href="https://www.google.com/maps?q=${Number(msg.lat)},${Number(msg.lng)}" target="_blank" rel="noopener noreferrer">
              <span class="chat-location-icon">${icon('mapPin', 22)}</span>
              <span><b>Ubicación compartida</b><small>Abrir en el mapa</small></span>
            </a>
            <div class="chat-card-time"><span>${timeStr}</span>${isMine ? ticksHtml : ''}</div>
          ` : msg.type === 'product' && msg.product ? `
            <div class="chat-product-card">
              ${msg.product.image ? `<img src="${escapeHtml(msg.product.image)}" alt="" loading="lazy">` : `<span class="chat-product-noimg">${icon('shoppingBag', 20)}</span>`}
              <span><b>${escapeHtml(msg.product.name)}</b>${Number(msg.product.price) > 0 ? `<small>$ ${Number(msg.product.price).toLocaleString('es-AR')}</small>` : ''}</span>
            </div>
            <div class="chat-card-time"><span>${timeStr}</span>${isMine ? ticksHtml : ''}</div>
          ` : msg.type === 'audio' ? `
            ${audioBubbleHtml(msg, { timeStr, ticksHtml: isMine ? ticksHtml : '', isMine })}
          ` : `
            <div style="display:flex; flex-direction:column; gap:2px; min-width:60px;">
              <span class="bubble-text ${msg.isDeletedView ? 'is-deleted' : ''}" style="word-break:break-word; padding-right:16px;">${escapeHtml(msg.text)}</span>
              <div style="display:flex; align-items:center; justify-content:flex-end; gap:3px; font-size:9.5px; color:${isMine ? '#a1a1aa' : '#9ca3af'}; font-weight:700; align-self:flex-end; margin-top:2px; margin-bottom:-4px; margin-right:-6px; opacity:0.85;">
                <span>${timeStr}</span>
                ${isMine ? ticksHtml : ''}
              </div>
            </div>
          `}
          ${reactionsHtml}
        </div>
        ${seenTimeHtml}
      </div>
        <!-- Action: Mark as Paid (Only for Commerce) -->
        ${canMarkPaid && !isMine && msg.type === 'image' && msg.status !== 'uploading' && chatType === 'client-commerce' && !msg.paidChecked ? `
          <div class="chat-bubble-actions">
            <button class="btn-mark-paid" onclick="window.markAsPaid('${chatId}', '${orderId}', '${msg.id}')">
              ${icon('checkCircle', 14)} Marcar como pagado
            </button>
          </div>
        ` : msg.paidChecked ? `
          <div class="paid-verified-badge">${icon('checkCircle', 12)} Pago verificado</div>
        ` : ''}
    `;
    rows.push({ key: msg.id, html });
  });
  pending.forEach(u => rows.push({ key: u.id, html: pendingUploadHtml(u), mine: true }));

  applyRows(container, rows, messages, currentUserId);
}

// Antes se redibujaba toda la lista con cada cambio (un visto, una reacción): las fotos parpadeaban
// y se cortaba el audio que estaba sonando. Ahora solo se toca el renglón que cambió.
function applyRows(container, rows, messages, currentUserId) {
  const first = !container._rows;
  if (first) {
    container._rows = new Map();
    container.innerHTML = '';
    bindImageEvents(container);
  }
  const known = container._rows;
  const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 140;
  const lastKey = rows[rows.length - 1]?.key;
  const newLast = lastKey && !known.has(lastKey);
  const lastIsMine = rows[rows.length - 1]?.mine || messages.find(m => m.id === lastKey)?.senderId === currentUserId;

  const wanted = new Set(rows.map(r => r.key));
  known.forEach((row, key) => {
    if (!wanted.has(key)) { row.el.remove(); known.delete(key); }
  });

  let cursor = container.firstElementChild;
  rows.forEach(({ key, html }) => {
    let row = known.get(key);
    if (!row) {
      const el = document.createElement('div');
      el.className = 'chat-row-wrap';
      el.innerHTML = html;
      row = { el, html };
      known.set(key, row);
      container.insertBefore(el, cursor);
    } else {
      // Un audio sonando se deja como está: se actualiza en el próximo cambio
      const playing = [...row.el.querySelectorAll('audio')].some(a => !a.paused);
      if (row.html !== html && !playing) {
        row.el.innerHTML = html;
        row.html = html;
      }
      if (row.el === cursor) cursor = cursor.nextElementSibling;
      else container.insertBefore(row.el, cursor);
    }
  });

  if (first || (newLast && (nearBottom || lastIsMine))) {
    container.scrollTop = container.scrollHeight;
    requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; });
  }
}

function bindImageEvents(container) {
  if (container.dataset.imagesReady) return;
  container.dataset.imagesReady = '1';
  // load y error no suben por el árbol: se escuchan en la fase de captura
  container.addEventListener('load', (e) => {
    if (!e.target.classList?.contains('chat-img')) return;
    e.target.classList.add('is-loaded');
    e.target.closest('.chat-image-container')?.classList.remove('has-failed');
  }, true);
  container.addEventListener('error', (e) => {
    if (e.target.classList?.contains('chat-img')) e.target.closest('.chat-image-container')?.classList.add('has-failed');
  }, true);
}

function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function updateRecordingStatus(chatRef, uid, on) {
  try {
    await updateDoc(chatRef, { [`recording.${uid}`]: on });
  } catch (e) {
    // Igual que escribiendo: si no se pudo, no importa
  }
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

function showTypingIndicator(chatId, show, otherName, what = 'está escribiendo') {
  const container = document.getElementById(`chat-typing-indicator-${chatId}`);
  if (!container) return;

  if (show) {
    container.innerHTML = `
      <div class="typing-bubble">
        <span class="typing-text">${escapeHtml(otherName)} ${what}</span>
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
