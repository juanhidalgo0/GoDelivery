// GoDelivery — Admin Live Support Chats Panel (Ticket Edition)
import { db } from '../../firebase.js';
import { collection, onSnapshot, doc, getDoc, updateDoc, deleteDoc, getDocs, arrayUnion, serverTimestamp, query, orderBy } from 'firebase/firestore';
import { icon } from '../../utils/icons.js';
import { showToast } from '../../components/toast.js';
import { showConfirm } from '../../components/modal.js';

export async function renderAdminSupportChats() {
  const content = document.getElementById('app-content');
  if (!content) return;

  // Render main structural framework
  content.innerHTML = `
    <div class="panel-page" style="position:relative; display:flex; flex-direction:column; height:100%; background:var(--color-bg); overflow:hidden;">
      
      <!-- Main Layout -->
      <div style="flex:1; display:flex; overflow:hidden; background:var(--color-bg-secondary);">
        
        <!-- Left Side: Chat Sessions List -->
        <div id="chats-list-sidebar" style="width:100%; max-width:360px; border-right:1px solid var(--color-border); display:flex; flex-direction:column; background:var(--color-surface); flex-shrink:0;">
          <div style="padding:16px; border-bottom:1px solid var(--color-border); display:flex; justify-content:space-between; align-items:center; flex-shrink:0;">
            <div style="font-size:12px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.05em; display:flex; gap:8px; align-items:center;">
              <span>Conversaciones</span>
              <span id="unread-count-badge" style="background:var(--color-primary); color:white; padding:2px 8px; border-radius:100px; font-size:10px; font-weight:900; display:none;">0</span>
            </div>
            
            <!-- Bulk Delete Action -->
            <button id="delete-all-chats-btn" style="border:none; background:transparent; color:var(--color-danger); cursor:pointer; display:flex; align-items:center; gap:6px; font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:0.05em; transition: opacity 0.2s;">
              ${icon('trash', 14)} Eliminar Todo
            </button>
          </div>
          <div id="support-chats-list" style="flex:1; overflow-y:auto; padding:10px; display:flex; flex-direction:column; gap:8px;">
            <div class="loader-dots" style="margin:40px auto;"><span></span><span></span><span></span></div>
          </div>
        </div>

        <!-- Right Side: Chat Conversation Details -->
        <div id="chat-conversation-area" style="flex:1; display:none; flex-direction:column; background:var(--color-bg);">
          <!-- Active User Header -->
          <div style="background:var(--color-surface); border-bottom:1px solid var(--color-border); padding:calc(14px + env(safe-area-inset-top, 0px)) 20px 14px; display:flex; align-items:center; gap:12px; flex-shrink:0; position:relative; overflow:hidden;">
            <!-- Mobile Back Button to list -->
            <button id="chat-back-to-list-btn" style="background:none; border:none; color:var(--color-text); cursor:pointer; padding:0; display:none; align-items:center; justify-content:center; width:36px; height:36px; border-radius:50%; background:var(--color-bg-secondary); margin-right:4px;">
              ${icon('chevronLeft', 24)}
            </button>

            <div style="width:40px; height:40px; border-radius:50%; background:var(--color-primary-lighter); color:var(--color-primary); display:flex; align-items:center; justify-content:center; font-weight:900; font-size:16px;" id="active-user-avatar">
              U
            </div>
            <div style="flex:1; min-width:0; display:flex; flex-direction:column; gap:4px;">
              <div style="display:flex; align-items:center; gap:6px; flex-wrap:nowrap; width:100%; overflow:hidden;">
                <span id="active-user-name" style="font-weight:900; font-size:14.5px; color:var(--color-text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:120px;">Selecciona un chat</span>
                <span id="active-user-goid" style="font-size:9.5px; font-weight:900; background:var(--color-primary-lighter); border:1px solid var(--color-primary-light); padding:1px 6px; border-radius:6px; color:var(--color-primary); display:none; flex-shrink:0;">GO-1002</span>
                <span id="active-ticket-badge" style="font-size:9.5px; font-weight:900; background:var(--color-bg-secondary); border:1px solid var(--color-border); padding:1px 6px; border-radius:6px; color:var(--color-text-secondary); flex-shrink:0;">#TK-0000</span>
              </div>
              <div style="font-size:11px; font-weight:700; color:var(--color-text-tertiary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" id="active-user-meta">Para empezar a responder</div>
            </div>

            <!-- Finish / Finalize Ticket Action -->
            <button id="finalize-ticket-btn" style="border:none; height:38px; border-radius:10px; background:var(--color-primary-lighter); color:var(--color-primary); display:flex; align-items:center; gap:6px; font-weight:800; font-size:12px; cursor:pointer; padding:0 12px; transition: all 0.2s;">
              ${icon('check', 14)} <span class="hide-mobile">Finalizar Consulta</span>
            </button>
          </div>

          <!-- Messages Container -->
          <div id="admin-chat-messages" style="flex:1; overflow-y:auto; padding:20px; display:flex; flex-direction:column; gap:12px;">
            <div style="text-align:center; padding:80px 20px; color:var(--color-text-tertiary); font-weight:600; font-size:14px;">
              Seleccioná un chat de la lista de la izquierda para ver el historial y responder.
            </div>
          </div>

          <!-- Bottom Reply Input -->
          <div id="admin-chat-footer" style="flex-shrink:0;">
            <div style="padding:12px 20px; background:var(--color-surface); border-top:1px solid var(--color-border); display:flex; gap:10px; align-items:center;">
              <!-- Camera Button -->
              <button id="admin-chat-image-btn" style="background:none; border:none; color:var(--color-text-secondary); cursor:pointer; display:flex; align-items:center; justify-content:center; width:36px; height:36px; border-radius:50%; transition:background 0.2s;">
                ${icon('camera', 20)}
              </button>
              <input type="file" id="admin-chat-image-input" accept="image/*" style="display:none;" />
              <input type="text" id="admin-chat-input" placeholder="Escribí tu respuesta..." style="flex:1; height:46px; border-radius:14px; border:1.5px solid var(--color-border); padding:0 16px; font-weight:700; font-size:13.5px; outline:none; background:var(--color-bg); color:var(--color-text);" />
              <button id="admin-chat-send" style="width:46px; height:46px; border-radius:14px; border:none; background:var(--color-primary); color:white; display:flex; align-items:center; justify-content:center; cursor:pointer; box-shadow:0 6px 15px rgba(var(--color-primary-rgb),0.25);">
                ${icon('send', 20)}
              </button>
            </div>
          </div>
        </div>

        <!-- Placeholder View on Desktop -->
        <div id="chat-placeholder-area" style="flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; padding:40px; background:var(--color-bg); color:var(--color-text-tertiary);">
          <div style="color:var(--color-primary); opacity:0.25; margin-bottom:16px; display:flex; align-items:center; justify-content:center;">${icon('chat', 64)}</div>
          <h3 style="font-family:var(--font-display); font-size:20px; font-weight:900; color:var(--color-text-secondary); margin-bottom:8px;">Mesa de Ayuda GoDelivery</h3>
          <p style="font-size:14px; max-width:320px; line-height:1.5; font-weight:600;">Monitoreá y contestá las dudas de clientes, repartidores y comercios en tiempo real.</p>
        </div>
      </div>
    </div>

    <!-- Responsive Layout Style -->
    <style>
      /* Force outer overlay and container to be non-scrollable for strict native app layout */
      #app-overlay {
        overflow: hidden !important;
      }
      .panel-page {
        height: 100% !important;
        overflow: hidden !important;
      }

      /* Fix mobile height collapsing */
      .slide-overlay #app-content {
        height: 100% !important;
        min-height: 100% !important;
        padding-bottom: 0 !important;
        overflow: hidden !important;
      }

      @media (max-width: 768px) {
        #app-overlay {
          top: var(--header-height, 64px) !important;
          bottom: calc(var(--navbar-height, 68px) + env(safe-area-inset-bottom, 20px) + 12px) !important;
          height: calc(100dvh - var(--header-height, 64px) - (var(--navbar-height, 68px) + env(safe-area-inset-bottom, 20px) + 12px)) !important;
        }
        #chats-list-sidebar { width: 100% !important; max-width: none !important; }
        #chat-conversation-area { position: absolute; inset: 0; z-index: 150; }
        #chat-placeholder-area { display: none !important; }
        #chat-back-to-list-btn { display: flex !important; }
        
        /* Ensure the active user header is properly padded and aligned on mobile */
        #chat-conversation-area > div:first-child {
          padding: 12px 16px !important;
          min-height: 64px !important;
          display: flex !important;
          align-items: center !important;
          box-sizing: border-box !important;
        }
      }
    </style>
  `;

  const chatsList = document.getElementById('support-chats-list');
  const chatArea = document.getElementById('chat-conversation-area');
  const placeholderArea = document.getElementById('chat-placeholder-area');
  const messagesBox = document.getElementById('admin-chat-messages');
  const chatFooter = document.getElementById('admin-chat-footer');
  const deleteAllBtn = document.getElementById('delete-all-chats-btn');
  const finalizeBtn = document.getElementById('finalize-ticket-btn');
  const backToListBtn = document.getElementById('chat-back-to-list-btn');

  const activeUserName = document.getElementById('active-user-name');
  const activeUserMeta = document.getElementById('active-user-meta');
  const activeUserAvatar = document.getElementById('active-user-avatar');
  const activeTicketBadge = document.getElementById('active-ticket-badge');
  const unreadCountBadge = document.getElementById('unread-count-badge');

  if (backToListBtn) {
    backToListBtn.onclick = () => {
      selectedChatId = null;
      chatArea.style.display = 'none';
      if (placeholderArea) placeholderArea.style.display = 'flex';
      document.querySelectorAll('.admin-chat-item-card').forEach(card => {
        card.style.background = 'transparent';
        card.style.borderColor = 'var(--color-border-light)';
      });
    };
  }

  let allChats = [];
  let selectedChatId = sessionStorage.getItem('admin-support-chat-target') || null;
  sessionStorage.removeItem('admin-support-chat-target');
  let activeChatsListener = null;

  // Clean up on unmount
  const cleanup = () => {
    if (activeChatsListener) activeChatsListener();
  };

  const selectChat = (chatId) => {
    selectedChatId = chatId;
    const chat = allChats.find(c => c.id === chatId);
    if (!chat) return;

    const isClosed = chat.status === 'closed';

    // Show conversation detail panel
    chatArea.style.display = 'flex';
    if (placeholderArea) placeholderArea.style.display = 'none';

    // Highlight selected item in sidebar
    document.querySelectorAll('.admin-chat-item-card').forEach(card => {
      card.style.background = card.dataset.id === chatId ? 'var(--color-primary-lighter)' : 'transparent';
      card.style.borderColor = card.dataset.id === chatId ? 'var(--color-primary-light)' : 'var(--color-border-light)';
    });

    // Populate active user header
    activeUserName.textContent = chat.userName || 'Usuario';
    activeUserMeta.textContent = `${chat.email || ''} | Rol: ${chat.userRole || 'Cliente'}`;
    activeUserAvatar.textContent = (chat.userName || 'U')[0].toUpperCase();
    
    const goIdEl = document.getElementById('active-user-goid');
    if (goIdEl) {
      if (chat.goId) {
        goIdEl.textContent = chat.goId;
        goIdEl.style.display = 'inline-block';
      } else {
        goIdEl.style.display = 'none';
        // Try fetching it dynamically
        if (chat.userId) {
          getDoc(doc(db, 'users', chat.userId)).then(uSnap => {
            if (uSnap.exists()) {
              const uData = uSnap.data();
              if (uData.goId) {
                goIdEl.textContent = uData.goId;
                goIdEl.style.display = 'inline-block';
              }
            }
          }).catch(() => {});
        }
      }
    }

    if (chat.ticketId) {
      activeTicketBadge.textContent = chat.ticketId;
      activeTicketBadge.style.display = 'inline-block';
    } else {
      activeTicketBadge.style.display = 'none';
    }

    // Toggle finalize button based on state
    if (isClosed) {
      finalizeBtn.style.display = 'none';
    } else {
      finalizeBtn.style.display = 'flex';
    }

    // Render messages
    const messages = chat.messages || [];
    if (messages.length === 0) {
      messagesBox.innerHTML = `<div style="text-align:center; padding:40px; color:var(--color-text-tertiary);">No hay mensajes en este chat.</div>`;
    } else {
      messagesBox.innerHTML = messages.map(msg => {
        const isUser = msg.sender === 'user';
        return `
          <div style="display:flex; flex-direction:column; align-self: ${isUser ? 'flex-start' : 'flex-end'}; max-width:80%; margin-bottom:4px;">
            <div style="
              padding:${(msg.image && !msg.audio) ? '8px' : '12px 16px'}; 
              border-radius:18px; 
              font-size:13px; 
              font-weight:600; 
              line-height:1.5;
              background:${isUser ? 'var(--color-bg-secondary)' : 'var(--color-primary)'}; 
              color:${isUser ? 'var(--color-text)' : 'white'};
              border-bottom-${isUser ? 'left' : 'right'}-radius:4px;
            ">
              ${msg.audio ? `
                <div style="display:flex;align-items:center;gap:10px;padding:4px 8px;">
                  <div style="background:rgba(255,255,255,0.2);border-radius:50%;padding:8px;display:flex;align-items:center;justify-content:center;color:${isUser ? 'var(--color-text)' : 'white'};">${icon('mic', 16)}</div>
                  <audio controls src="${msg.audio}" style="height:32px;max-width:180px;"></audio>
                </div>
              ` : msg.image ? `
                <img src="${msg.image}" style="max-width:100%; border-radius:12px; display:block; cursor:pointer; box-shadow:var(--shadow-sm);" onclick="window.open('${msg.image}')" />
                ${msg.text && msg.text !== '📷 Foto enviada' ? `<div style="margin-top:6px;">${msg.text}</div>` : ''}
              ` : msg.text}
            </div>
          </div>
        `;
      }).join('');
      messagesBox.scrollTop = messagesBox.scrollHeight;
    }

    // If chat is closed, display closed banner instead of text input
    if (isClosed) {
      chatFooter.innerHTML = `
        <div style="background:var(--color-bg-secondary); border-top:1px solid var(--color-border); padding:16px 20px; text-align:center; font-size:12.5px; font-weight:800; color:var(--color-text-secondary); display:flex; align-items:center; justify-content:center; gap:6px; width:100%;">
          ${icon('lock', 14)} Este ticket fue finalizado. El chat se encuentra inhabilitado.
        </div>
      `;
    } else {
      chatFooter.innerHTML = `
        <div class="chat-input-bar" style="width:100%; box-sizing:border-box; position:relative;">
          <button class="chat-attach-btn" id="admin-chat-attach-btn" title="Adjuntar imagen">${icon('camera', 20)}</button>
          <input type="file" id="admin-chat-file-gallery" style="display:none;" accept="image/*" />
          <input type="file" id="admin-chat-file-camera" style="display:none;" accept="image/*" capture="environment" />
          <input type="text" id="admin-chat-input" class="chat-input" placeholder="Escribí tu respuesta..." autocomplete="off" />
          <button class="chat-mic-btn" id="admin-chat-mic-btn" title="Grabar audio" style="color:var(--color-primary);">${icon('mic', 20)}</button>
          <button class="chat-send-btn" id="admin-chat-send">
            ${icon('send', 20)}
          </button>
        </div>
        <!-- Audio recording indicator -->
        <div id="admin-audio-indicator" style="display:none; position:absolute; bottom: 85px; left: 50%; transform: translateX(-50%); background: var(--color-surface); border: 1.5px solid var(--color-border); padding: 10px 20px; border-radius: 20px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); align-items: center; gap: 10px; z-index: 1000;">
          <div class="recording-dot" style="width: 10px; height: 10px; background: red; border-radius: 50%; animation: pulse 1s infinite;"></div>
          <span id="admin-audio-timer" style="font-weight: 700; font-size: 14px; color:var(--color-text);">0:00</span>
          <span style="font-size: 11px; color: var(--color-text-tertiary); margin-left: 8px;">(Soltá para enviar)</span>
        </div>
      `;

      // Rebind send listeners
      const input = chatFooter.querySelector('#admin-chat-input');
      const send = chatFooter.querySelector('#admin-chat-send');
      const attachBtn = chatFooter.querySelector('#admin-chat-attach-btn');
      const fileInputGallery = chatFooter.querySelector('#admin-chat-file-gallery');
      const fileInputCamera = chatFooter.querySelector('#admin-chat-file-camera');
      const micBtn = chatFooter.querySelector('#admin-chat-mic-btn');
      const audioIndicator = chatFooter.querySelector('#admin-audio-indicator');
      const audioTimer = chatFooter.querySelector('#admin-audio-timer');

      send.onclick = handleSendResponse;
      input.onkeydown = (e) => {
        if (e.key === 'Enter') handleSendResponse();
      };

      if (attachBtn) {
        attachBtn.onclick = () => {
          import('../../components/modal.js').then(m => {
            m.showModal({
              title: 'Enviar imagen',
              content: `
                <div style="padding: 24px 20px; display: flex; flex-direction: column; gap: 16px;">
                  <button id="btn-use-camera-admin" style="width: 100%; height: 56px; border-radius: 18px; background: var(--color-primary); color: white; border: none; font-weight: 850; font-size: 15px; display: flex; align-items: center; justify-content: center; gap: 10px; cursor: pointer; box-shadow: 0 8px 20px rgba(var(--color-primary-rgb), 0.25);">
                    ${icon('camera', 20)} Tomar Foto (Cámara)
                  </button>
                  <button id="btn-use-gallery-admin" style="width: 100%; height: 56px; border-radius: 18px; background: var(--color-bg-secondary); border: 1.5px solid var(--color-border); color: var(--color-text-primary); font-weight: 850; font-size: 15px; display: flex; align-items: center; justify-content: center; gap: 10px; cursor: pointer;">
                    ${icon('image', 20)} Seleccionar de Galería
                  </button>
                </div>
              `,
              height: 'auto',
              hideHeader: true,
              onOpen: () => {
                const btnCamera = document.getElementById('btn-use-camera-admin');
                const btnGallery = document.getElementById('btn-use-gallery-admin');
                if (btnCamera) btnCamera.onclick = () => { m.closeModal(); fileInputCamera?.click(); };
                if (btnGallery) btnGallery.onclick = () => { m.closeModal(); fileInputGallery?.click(); };
              }
            });
          });
        };
      }

      if (fileInputGallery) fileInputGallery.onchange = (e) => handleSendAdminImage(e.target.files[0]);
      if (fileInputCamera) fileInputCamera.onchange = (e) => handleSendAdminImage(e.target.files[0]);

      // Audio recording handling
      let mediaRecorder;
      let audioChunks = [];
      let recordStartTime;
      let recordTimer;
      let isRecording = false;

      micBtn.addEventListener('pointerdown', async (e) => {
        e.preventDefault();
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
              micBtn.style.color = 'red';
              micBtn.style.transform = 'scale(1.2)';
              recordTimer = setInterval(() => {
                const elapsed = Math.floor((Date.now() - recordStartTime) / 1000);
                const m = Math.floor(elapsed / 60);
                const s = (elapsed % 60).toString().padStart(2, '0');
                audioTimer.textContent = `${m}:${s}`;
              }, 1000);
            };

            mediaRecorder.onstop = async () => {
              isRecording = false;
              clearInterval(recordTimer);
              audioIndicator.style.display = 'none';
              micBtn.style.color = '';
              micBtn.style.transform = '';
              
              stream.getTracks().forEach(track => track.stop());

              if (audioChunks.length > 0) {
                const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                const reader = new FileReader();
                reader.readAsDataURL(audioBlob);
                reader.onloadend = () => {
                  handleSendAdminAudio(reader.result);
                };
              }
            };

            mediaRecorder.start();
          } catch (err) {
            console.error("Mic access error:", err);
            showToast('Permiso de micrófono denegado', 'danger');
          }
        }
      });

      const stopRecording = () => {
        if (isRecording && mediaRecorder && mediaRecorder.state !== 'inactive') {
          mediaRecorder.stop();
        }
      };

      micBtn.addEventListener('pointerup', stopRecording);
      micBtn.addEventListener('pointerleave', stopRecording);
      input.focus();
    }

    // Mark as read by admin in database
    if (chat.unreadByAdmin) {
      updateDoc(doc(db, 'support_chats', chatId), { unreadByAdmin: false }).catch(() => {});
    }
  };

  const handleSendResponse = async () => {
    if (!selectedChatId) return;
    const input = chatFooter.querySelector('#admin-chat-input');
    const send = chatFooter.querySelector('#admin-chat-send');
    if (!input) return;

    const text = input.value.trim();
    if (!text) return;

    input.value = '';
    input.disabled = true;
    send.disabled = true;

    try {
      const responseMessage = {
        sender: 'admin',
        text: text,
        timestamp: Date.now()
      };

      await updateDoc(doc(db, 'support_chats', selectedChatId), {
        status: 'approved',
        unreadByUser: true,
        unreadByAdmin: false,
        lastMessageText: text,
        lastMessageTime: serverTimestamp(),
        messages: arrayUnion(responseMessage)
      });
    } catch (err) {
      console.error('Error sending support response:', err);
      showToast('Error al enviar la respuesta', 'danger');
    } finally {
      if (input) {
        input.disabled = false;
        input.focus();
      }
      if (send) send.disabled = false;
    }
  };

  const handleSendAdminImage = async (file) => {
    if (!selectedChatId) return;

    try {
      showToast('Comprimiendo y enviando imagen...', 'info');
      const { compressImageToBase64 } = await import('../../utils/image.js');
      const base64Data = await compressImageToBase64(file, 800, 0.6);

      const responseMessage = {
        sender: 'admin',
        text: '📷 Foto enviada',
        image: base64Data,
        timestamp: Date.now()
      };

      await updateDoc(doc(db, 'support_chats', selectedChatId), {
        status: 'approved',
        unreadByUser: true,
        unreadByAdmin: false,
        lastMessageText: '📷 Foto',
        lastMessageTime: serverTimestamp(),
        messages: arrayUnion(responseMessage)
      });
      showToast('Imagen enviada con éxito', 'success');
    } catch (err) {
      console.error('Error sending support admin image:', err);
      showToast('Error al enviar la imagen', 'danger');
    }
  };

  const handleSendAdminAudio = async (base64Audio) => {
    if (!selectedChatId) return;

    try {
      showToast('Enviando audio...', 'info');
      const responseMessage = {
        sender: 'admin',
        text: '🎙 Mensaje de voz',
        audio: base64Audio,
        timestamp: Date.now()
      };

      await updateDoc(doc(db, 'support_chats', selectedChatId), {
        status: 'approved',
        unreadByUser: true,
        unreadByAdmin: false,
        lastMessageText: '🎙 Mensaje de voz',
        lastMessageTime: serverTimestamp(),
        messages: arrayUnion(responseMessage)
      });
      showToast('Audio enviado con éxito', 'success');
    } catch (err) {
      console.error('Error sending support admin audio:', err);
      showToast('Error al enviar el audio', 'danger');
    }
  };

  // Finalize Ticket Action
  finalizeBtn.onclick = () => {
    if (!selectedChatId) return;
    const chat = allChats.find(c => c.id === selectedChatId);
    if (!chat) return;

    showConfirm({
      title: '¿Finalizar consulta?',
      message: `Esta acción finalizará la consulta de "${chat.userName}" y eliminará permanentemente este ticket de la base de datos de soporte. ¿Estás seguro?`,
      confirmText: 'Sí, finalizar y eliminar',
      cancelText: 'Cancelar',
      danger: true,
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'support_chats', selectedChatId));
          showToast('Ticket finalizado y eliminado con éxito', 'success');
        } catch (err) {
          console.error('Error finalising support ticket:', err);
          showToast('Error al finalizar el ticket', 'danger');
        }
      }
    });
  };

  // Bulk Delete Action
  deleteAllBtn.onclick = () => {
    showConfirm({
      title: '¿Eliminar todos los chats?',
      message: 'Esta acción borrará de forma permanente todos los historiales y tickets de soporte de la base de datos. Los usuarios podrán iniciar nuevas consultas si es necesario. ¿Estás seguro?',
      confirmText: 'Sí, borrar todo',
      cancelText: 'Cancelar',
      danger: true,
      onConfirm: async () => {
        try {
          const snap = await getDocs(collection(db, 'support_chats'));
          const promises = snap.docs.map(d => deleteDoc(doc(db, 'support_chats', d.id)));
          await Promise.all(promises);

          showToast('Todas las conversaciones han sido eliminadas', 'success');
          
          // Reset chat details view
          selectedChatId = null;
          chatArea.style.display = 'none';
          if (placeholderArea) placeholderArea.style.display = 'flex';

        } catch (err) {
          console.error('Error deleting all support chats:', err);
          showToast('Error al vaciar base de datos de chats', 'danger');
        }
      }
    });
  };

  // Real-time listener for support chats collection
  activeChatsListener = onSnapshot(collection(db, 'support_chats'), (snap) => {
    allChats = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Sort by last message time descending
    allChats.sort((a, b) => {
      const tA = a.lastMessageTime?.seconds || 0;
      const tB = b.lastMessageTime?.seconds || 0;
      return tB - tA;
    });

    // Update unread count badge
    const unreadCount = allChats.filter(c => c.unreadByAdmin).length;
    if (unreadCount > 0) {
      unreadCountBadge.textContent = unreadCount;
      unreadCountBadge.style.display = 'inline-block';
    } else {
      unreadCountBadge.style.display = 'none';
    }

    // Explicitly synchronize with global state so footer navbar badge remains 100% in sync
    import('../../state.js').then(m => m.setState('unreadSupportCount', unreadCount)).catch(() => {});

    if (allChats.length === 0) {
      chatsList.innerHTML = `<div style="text-align:center; padding:30px; font-size:13px; color:var(--color-text-tertiary); font-weight:600;">No hay chats activos</div>`;
      selectedChatId = null;
      chatArea.style.display = 'none';
      if (placeholderArea) placeholderArea.style.display = 'flex';
      return;
    }

    // Render sessions sidebar
    chatsList.innerHTML = allChats.map(c => {
      const activeText = c.unreadByAdmin ? 'font-weight:900;' : 'font-weight:600;';
      const indicatorColor = c.unreadByAdmin ? 'var(--color-primary)' : 'transparent';
      const timeStr = c.lastMessageTime && c.lastMessageTime.seconds ? new Date(c.lastMessageTime.seconds * 1000).toLocaleTimeString('es-AR', {
        hour: '2-digit',
        minute: '2-digit'
      }) : 'Hoy';

      const isClosed = c.status === 'closed';
      const isPendingApproval = c.status === 'pending_approval';

      return `
        <div class="admin-chat-item-card" data-id="${c.id}" style="
          padding:14px; 
          border-radius:18px; 
          border:1px solid ${c.id === selectedChatId ? 'var(--color-primary-light)' : 'var(--color-border-light)'}; 
          background:${c.id === selectedChatId ? 'var(--color-primary-lighter)' : 'var(--surface-color, var(--color-surface))'}; 
          cursor:pointer; 
          display:flex; 
          gap:12px; 
          align-items:center;
          position:relative;
          transition:all 0.2s;
          opacity: ${isClosed ? '0.75' : '1'};
        ">
          <!-- Unread indicator bar -->
          <div style="position:absolute; left:0; top:12px; bottom:12px; width:4px; border-radius:0 4px 4px 0; background:${indicatorColor};"></div>
          
          <div style="flex:1; min-width:0;">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
              <span style="font-weight:800; font-size:14px; color:var(--color-text); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; display:flex; align-items:center; gap:6px;">
                ${c.userName || 'Usuario'}
                ${isClosed ? `<span style="color:var(--color-text-tertiary); display:flex; align-items:center;">${icon('lock', 11)}</span>` : ''}
                ${isPendingApproval ? '<span style="font-size:10px; font-weight:900; background:#fef3c7; color:#d97706; border:1px solid rgba(217,119,6,0.2); padding:1px 6px; border-radius:6px; letter-spacing:0.02em;">PENDIENTE</span>' : ''}
              </span>
              <span style="font-size:10px; font-weight:700; color:var(--color-text-tertiary); flex-shrink:0;">${timeStr}</span>
            </div>
            <div style="display:flex; align-items:center; gap:6px; margin-top:2px;">
              <span style="font-size:9px; font-weight:900; text-transform:uppercase; color:${isClosed ? 'var(--color-text-tertiary)' : 'var(--color-primary)'}; background:${isClosed ? 'var(--color-bg-secondary)' : 'var(--color-primary-lighter)'}; padding:1px 6px; border-radius:4px;">
                ${c.ticketId || '#TK-0000'}
              </span>
              <span style="font-size:12px; color:var(--color-text-secondary); ${activeText} overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1;">${c.lastMessageText || 'Chat de soporte'}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Bind sidebar clicks
    chatsList.querySelectorAll('.admin-chat-item-card').forEach(card => {
      card.onclick = () => selectChat(card.dataset.id);
    });

    // Update active chat if currently open
    if (selectedChatId) {
      const stillExists = allChats.some(c => c.id === selectedChatId);
      if (stillExists) {
        selectChat(selectedChatId);
      } else {
        selectedChatId = null;
        chatArea.style.display = 'none';
        if (placeholderArea) placeholderArea.style.display = 'flex';
      }
    }
  });

  return { cleanup };
}
