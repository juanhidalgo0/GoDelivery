import { db } from '../firebase.js';
import { doc, getDoc, collection, addDoc, query, orderBy, onSnapshot, updateDoc, arrayRemove } from 'firebase/firestore';
import { getState } from '../state.js';
import { icon } from '../utils/icons.js';
import { showConfirm, showAlert } from '../components/modal.js';

export async function renderMarketplaceChat(chatId, content) {
  if (!content) content = document.getElementById('app-content');
  if (!content) return;

  const currentUser = getState().user;
  if (!currentUser) {
    window.location.hash = '#/profile';
    return;
  }

  content.innerHTML = `
    <div class="marketplace-chat-container" style="display:flex; flex-direction:column; height:100%; background:var(--color-bg); position:relative; box-sizing:border-box;">
      <div style="padding:40px; text-align:center; color:var(--color-text-secondary);">
        Cargando chat...
      </div>
    </div>
  `;

  let unsubscribeChat = null;
  let unsubscribeMessages = null;

  try {
    const chatDocRef = doc(db, 'marketplace_chats', chatId);
    const chatSnap = await getDoc(chatDocRef);

    if (!chatSnap.exists()) {
      content.innerHTML = `
        <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; padding:20px; text-align:center;">
          <h3 style="margin-bottom:8px;">El chat no existe</h3>
          <a href="#/marketplace" style="background:var(--color-primary); color:white; padding:10px 20px; border-radius:10px; text-decoration:none; font-weight:700;">Volver al Marketplace</a>
        </div>
      `;
      return;
    }

    const chatData = chatSnap.data();
    const otherParticipantName = currentUser.uid === chatData.buyerId ? chatData.sellerName : chatData.buyerName;

    // Render Chat Layout
    content.innerHTML = `
      <div class="marketplace-chat-container" style="display:flex; flex-direction:column; height:100dvh; background:var(--color-bg); position:relative; box-sizing:border-box; overflow:hidden;">
        <!-- Header (Red Premium style) -->
        <div style="background:var(--color-primary); padding:calc(16px + env(safe-area-inset-top, 0px)) 20px 16px; display:flex; align-items:center; gap:16px; flex-shrink:0; position:relative; overflow:hidden; box-shadow:0 4px 12px rgba(var(--color-primary-rgb),0.2); z-index:100;">
          <a href="#/marketplace" style="width:40px; height:40px; border-radius:12px; background:rgba(255,255,255,0.15); border:none; display:flex; align-items:center; justify-content:center; color:white; text-decoration:none; transition:all 0.2s;">
            ${icon('chevronLeft', 24)}
          </a>
          <div style="flex:1; min-width:0;">
            <span style="font-size:16px; font-weight:900; color:white; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; display:block;">${otherParticipantName}</span>
            <span style="font-size:11px; color:rgba(255,255,255,0.8); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; display:block;">Interés: ${chatData.productTitle}</span>
          </div>
          <a href="#/marketplace/product/${chatData.productId}" style="width:40px; height:40px; border-radius:8px; overflow:hidden; border:1px solid rgba(255,255,255,0.3); display:flex; flex-shrink:0;">
            <img src="${chatData.productImage || '/logo.png'}" style="width:100%; height:100%; object-fit:cover;" />
          </a>
        </div>

        <!-- Warning notice / Actions -->
        <div id="chat-actions-bar" style="padding:8px 16px; background:#FEF3C7; color:#92400E; font-size:11px; font-weight:700; text-align:center; border-bottom:1px solid #FDE68A; flex-shrink:0; display:flex; align-items:center; justify-content:center; gap:8px; z-index:90;">
          <span>⚠️ Por seguridad, no envíes datos de contacto.</span>
          ${currentUser.uid === chatData.sellerId ? `
            <button id="btn-mark-sold" style="background:#10B981; color:white; border:none; border-radius:6px; padding:4px 8px; font-size:10px; font-weight:800; cursor:pointer; text-transform:uppercase;">Marcar como Vendido</button>
          ` : ''}
        </div>

        <!-- Messages Area -->
        <div id="chat-messages-list" style="flex:1; overflow-y:auto; padding:16px; display:flex; flex-direction:column; gap:12px; box-sizing:border-box; background:var(--color-bg);">
          <!-- Real-time messages will be rendered here -->
        </div>

        <!-- Input Footer -->
        <div class="chat-input-bar" style="width:100%; box-sizing:border-box;">
          <button class="chat-attach-btn" id="chat-attach-${chatId}" title="Adjuntar imagen">${icon('camera', 20)}</button>
          <input type="file" id="chat-file-gallery-${chatId}" style="display:none" accept="image/*" />
          <input type="file" id="chat-file-camera-${chatId}" style="display:none" accept="image/*" capture="environment" />
          <input type="text" id="chat-input" class="chat-input" placeholder="Escribí tu mensaje..." autocomplete="off" />
          <button class="chat-mic-btn" id="chat-mic-${chatId}" title="Grabar audio" style="color:var(--color-primary);">${icon('mic', 20)}</button>
          <button class="chat-send-btn" id="chat-send-btn">
            ${icon('send', 18) || '✈️'}
          </button>
        </div>

        <!-- Audio recording indicator -->
        <div id="chat-audio-indicator-${chatId}" style="display:none; position:absolute; bottom: 85px; left: 50%; transform: translateX(-50%); background: var(--color-surface); border: 1.5px solid var(--color-border); padding: 10px 20px; border-radius: 20px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); align-items: center; gap: 10px; z-index: 100;">
          <div class="recording-dot" style="width: 10px; height: 10px; background: red; border-radius: 50%; animation: pulse 1s infinite;"></div>
          <span id="chat-audio-timer-${chatId}" style="font-weight: 700; font-size: 14px; color:var(--color-text);">0:00</span>
          <span style="font-size: 11px; color: var(--color-text-tertiary); margin-left: 8px;">(Soltá para enviar)</span>
        </div>
      </div>
    `;

    const messagesList = content.querySelector('#chat-messages-list');
    const chatInput = content.querySelector('#chat-input');
    const sendBtn = content.querySelector('#chat-send-btn');
    const attachBtn = content.querySelector(`#chat-attach-${chatId}`);
    const micBtn = content.querySelector(`#chat-mic-${chatId}`);
    const audioIndicator = content.querySelector(`#chat-audio-indicator-${chatId}`);
    const audioTimer = content.querySelector(`#chat-audio-timer-${chatId}`);
    const fileInputGallery = content.querySelector(`#chat-file-gallery-${chatId}`);
    const fileInputCamera = content.querySelector(`#chat-file-camera-${chatId}`);

    // Mark chat as read
    if (chatData.unreadBy?.includes(currentUser.uid)) {
      updateDoc(chatDocRef, {
        unreadBy: arrayRemove(currentUser.uid)
      });
    }

    // Subscribe to messages
    const messagesQuery = query(
      collection(db, 'marketplace_chats', chatId, 'messages'),
      orderBy('createdAt', 'asc')
    );

    unsubscribeMessages = onSnapshot(messagesQuery, (snapshot) => {
      messagesList.innerHTML = snapshot.docs.map(docSnap => {
        const msg = docSnap.data();
        const isMe = msg.senderId === currentUser.uid;

        const dateObj = msg.timestamp ? msg.timestamp.toDate() : new Date();
        const timeStr = dateObj.toLocaleTimeString('es-AR', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true
        }).toLowerCase();

        const isMine = isMe;
        const ticksHtml = isMine ? (
          (!msg.timestamp) ? `
            <span class="chat-tick" style="display:inline-flex; align-items:center; vertical-align:middle; line-height:1;">
              <svg width="11" height="11" viewBox="0 0 16 11" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M1 5L5 9L15 1.5" stroke="currentColor" opacity="0.6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </span>
          ` : (
            msg.read ? `
              <span class="chat-tick" style="display:inline-flex; align-items:center; vertical-align:middle; line-height:1;">
                <svg width="15" height="11" viewBox="0 0 16 11" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M1 5L5 9L15 1.5" stroke="#38bdf8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
                  <path d="M5 5L9 9L19 1.5" stroke="#38bdf8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" transform="translate(-4, 0)"/>
                </svg>
              </span>
            ` : `
              <span class="chat-tick" style="display:inline-flex; align-items:center; vertical-align:middle; line-height:1;">
                <svg width="15" height="11" viewBox="0 0 16 11" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M1 5L5 9L15 1.5" stroke="currentColor" opacity="0.6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
                  <path d="M5 5L9 9L19 1.5" stroke="currentColor" opacity="0.6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" transform="translate(-4, 0)"/>
                </svg>
              </span>
            `
          )
        ) : '';

        let contentHtml = '';
        if (msg.type === 'image') {
          contentHtml = `<img src="${msg.imageUrl}" style="max-width:200px; max-height:200px; border-radius:12px; display:block; cursor:pointer; margin-bottom:10px;" onclick="window.openLightbox('${msg.imageUrl}')" />`;
        } else if (msg.type === 'audio') {
          contentHtml = `<audio src="${msg.audioUrl}" controls style="max-width:220px; margin-bottom:10px;"></audio>`;
        } else {
          contentHtml = `<span style="display:block; margin-bottom:10px; padding-right:16px;">${msg.text}</span>`;
        }

        return `
          <div style="display:flex; justify-content:${isMe ? 'flex-end' : 'flex-start'}; width:100%;">
            <div style="max-width:75%; padding:10px 14px 18px 14px; border-radius:16px; font-size:14px; line-height:1.4; word-break:break-word;
              background:${isMe ? 'var(--color-primary)' : 'var(--color-bg-secondary)'};
              color:${isMe ? 'white' : 'var(--color-text)'};
              border-bottom-right-radius:${isMe ? '4px' : '16px'};
              border-bottom-left-radius:${isMe ? '16px' : '4px'};
              box-shadow:var(--shadow-sm);
              position:relative;
              min-width:70px;
            ">
              ${contentHtml}
              <div style="position:absolute; bottom:4px; right:10px; display:flex; align-items:center; gap:2px; font-size:9.5px; opacity:0.8; font-weight:700; color:${isMe ? 'rgba(255,255,255,0.75)' : 'var(--color-text-tertiary)'};">
                <span>${timeStr}</span>
                ${ticksHtml}
              </div>
            </div>
          </div>
        `;
      }).join('');
      // Scroll to bottom
      messagesList.scrollTop = messagesList.scrollHeight;
    });

    const sendMessage = async () => {
      const text = chatInput.value.trim();
      if (!text) return;

      chatInput.value = '';

      // Clean message (Anti-bypass verification: Reject if phone or email)
      const phoneOrEmailRegex = /(\b[0-9]{3,4}[- ]?[0-9]{3,4}[- ]?[0-9]{3,4}\b)|(\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b)/g;
      if (phoneOrEmailRegex.test(text)) {
        showAlert({
          title: 'Seguridad GoDelivery',
          message: 'Por políticas de seguridad de GoDelivery, no podés enviar números de teléfono o correos por el chat. Mantener el contacto por este medio.'
        });
        return;
      }

      try {
        const timestamp = new Date();
        await addDoc(collection(db, 'marketplace_chats', chatId, 'messages'), {
          senderId: currentUser.uid,
          senderName: currentUser.displayName || 'Usuario',
          text,
          createdAt: timestamp
        });

        await updateDoc(chatDocRef, {
          lastMessage: text,
          lastMessageAt: timestamp,
          unreadBy: [currentUser.uid === chatData.buyerId ? chatData.sellerId : chatData.buyerId]
        });
      } catch (err) {
        console.error('Error sending message:', err);
      }
    };

    sendBtn.onclick = sendMessage;
    chatInput.onkeydown = (e) => {
      if (e.key === 'Enter') sendMessage();
    };

    // Attach Image Handler
    attachBtn.onclick = () => {
      import('../components/modal.js').then(m => {
        m.showModal({
          title: 'Enviar imagen',
          content: `
            <div style="padding: 24px 20px calc(24px + env(safe-area-inset-bottom, 0px)) 20px; display: flex; flex-direction: column; gap: 16px;">
              <button id="btn-use-camera-${chatId}" style="width: 100%; height: 56px; border-radius: 18px; background: var(--color-primary); color: white; border: none; font-weight: 850; font-size: 15px; display: flex; align-items: center; justify-content: center; gap: 10px; cursor: pointer;">
                ${icon('camera', 20)} Tomar Foto (Cámara)
              </button>
              <button id="btn-use-gallery-${chatId}" style="width: 100%; height: 56px; border-radius: 18px; background: var(--color-bg-secondary); border: 1.5px solid var(--color-border); color: var(--color-text-primary); font-weight: 850; font-size: 15px; display: flex; align-items: center; justify-content: center; gap: 10px; cursor: pointer;">
                ${icon('image', 20)} Seleccionar de Galería
              </button>
            </div>
          `,
          height: 'auto',
          hideHeader: true,
          onOpen: () => {
            const btnCam = document.getElementById(`btn-use-camera-${chatId}`);
            const btnGal = document.getElementById(`btn-use-gallery-${chatId}`);
            if (btnCam) btnCam.onclick = () => { m.closeModal(); fileInputCamera.click(); };
            if (btnGal) btnGal.onclick = () => { m.closeModal(); fileInputGallery.click(); };
          }
        });
      });
    };

    const handleFileUpload = async (file) => {
      if (!file) return;
      try {
        const { getStorage, ref, uploadBytes, getDownloadURL } = await import('firebase/storage');
        const storage = getStorage();
        const fileRef = ref(storage, `chats/${chatId}/${Date.now()}_${file.name}`);
        
        await uploadBytes(fileRef, file);
        const url = await getDownloadURL(fileRef);

        await addDoc(collection(db, 'marketplace_chats', chatId, 'messages'), {
          senderId: currentUser.uid,
          senderName: currentUser.displayName || 'Usuario',
          type: 'image',
          imageUrl: url,
          createdAt: new Date()
        });

        await updateDoc(chatDocRef, {
          lastMessage: '📷 Imagen',
          lastMessageAt: new Date(),
          unreadBy: [currentUser.uid === chatData.buyerId ? chatData.sellerId : chatData.buyerId]
        });
      } catch (err) {
        console.error(err);
      }
    };

    fileInputGallery.onchange = (e) => handleFileUpload(e.target.files[0]);
    fileInputCamera.onchange = (e) => handleFileUpload(e.target.files[0]);

    // Audio Recorder
    let mediaRecorder;
    let audioChunks = [];
    let recordTimer;
    let isRecording = false;
    let startX = 0;
    let isCancelled = false;

    micBtn.addEventListener('pointerdown', async (e) => {
      e.preventDefault();
      startX = e.clientX;
      isCancelled = false;
      try {
        micBtn.setPointerCapture(e.pointerId);
      } catch (err) {}

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
            const startTime = Date.now();
            audioIndicator.style.display = 'flex';
            micBtn.style.backgroundColor = 'var(--color-primary)';
            micBtn.style.color = 'white';
            micBtn.style.transform = 'scale(1.4)';
            micBtn.style.boxShadow = '0 0 15px rgba(225, 29, 72, 0.5)';
            micBtn.style.borderRadius = '50%';

            recordTimer = setInterval(() => {
              const elapsed = Math.floor((Date.now() - startTime) / 1000);
              const m = Math.floor(elapsed / 60);
              const s = (elapsed % 60).toString().padStart(2, '0');
              audioTimer.textContent = `${m}:${s} (Deslizá < para cancelar)`;
            }, 1000);
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
            
            stream.getTracks().forEach(track => track.stop());

            if (audioChunks.length > 0 && !isCancelled) {
              const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
              try {
                const { getStorage, ref, uploadBytes, getDownloadURL } = await import('firebase/storage');
                const storage = getStorage();
                const fileRef = ref(storage, `chats/${chatId}/audio_${Date.now()}.webm`);
                
                await uploadBytes(fileRef, audioBlob);
                const url = await getDownloadURL(fileRef);

                await addDoc(collection(db, 'marketplace_chats', chatId, 'messages'), {
                  senderId: currentUser.uid,
                  senderName: currentUser.displayName || 'Usuario',
                  type: 'audio',
                  audioUrl: url,
                  createdAt: new Date()
                });

                await updateDoc(chatDocRef, {
                  lastMessage: '🎙 Mensaje de voz',
                  lastMessageAt: new Date(),
                  unreadBy: [currentUser.uid === chatData.buyerId ? chatData.sellerId : chatData.buyerId]
                });
              } catch (error) {
                console.error(error);
              }
            }
          };

          mediaRecorder.start();
        } catch (err) {
          console.error(err);
        }
      }
    });

    micBtn.addEventListener('pointermove', (e) => {
      if (isRecording) {
        const diffX = startX - e.clientX;
        if (diffX > 80) {
          isCancelled = true;
          stopRec();
          import('../components/toast.js').then(m => m.showToast('Grabación cancelada', 'warning'));
        }
      }
    });

    const stopRec = () => {
      if (isRecording && mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
      }
    };

    micBtn.addEventListener('pointerup', stopRec);

    // Confirm / Mark Sold Bindings
    const markSoldBtn = content.querySelector('#btn-mark-sold');

    if (markSoldBtn) {
      markSoldBtn.onclick = () => {
        showConfirm({
          title: '¿Marcar como vendido?',
          message: '¿Marcar este producto como vendido? Esta acción cerrará la publicación.',
          confirmText: 'Sí, vender',
          cancelText: 'Cancelar',
          onConfirm: async () => {
            try {
              await updateDoc(doc(db, 'marketplace_products', chatData.productId), {
                status: 'sold'
              });
              showAlert({
                title: 'Venta Exitosa',
                message: '¡Producto marcado como vendido!',
                onClose: () => {
                  window.location.hash = '#/marketplace';
                }
              });
            } catch (err) {
              console.error(err);
            }
          }
        });
      };
    }



  } catch (err) {
    console.error('Error setting up chat page:', err);
  }

  return {
    cleanup: () => {
      if (unsubscribeChat) unsubscribeChat();
      if (unsubscribeMessages) unsubscribeMessages();
    }
  };
}
