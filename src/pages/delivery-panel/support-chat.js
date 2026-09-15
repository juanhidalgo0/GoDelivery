// Direct support chat modal for the driver panel.
// Extracted from delivery-panel.js so this code is only fetched/parsed when the
// driver actually opens the support chat, instead of on every panel load.
import { getState } from '../../state.js';
import { showToast } from '../../components/toast.js';
import { getDriverMapTheme } from '../../components/driver-navigation-map.js';

export async function openDriverDirectSupportChat(user) {
  const latestUser = getState().user || user || {};
  if (!latestUser.uid) {
    showToast('Inicia sesión para chatear con soporte', 'warning');
    return;
  }

  const isLight = getDriverMapTheme() === 'light';
  const existingModal = document.getElementById('driver-support-chat-modal');
  if (existingModal) existingModal.remove();

  const driverId = latestUser.uid;
  const driverName = latestUser.displayName || latestUser.name || 'Repartidor';
  const driverDeliveryId = latestUser.deliveryId || 'Oficial';
  const chatId = `driver_${driverId}`;

  const { db } = await import('../../firebase.js');
  const { doc, getDoc, setDoc, updateDoc, onSnapshot, arrayUnion, serverTimestamp, getDocs, query, collection, where, addDoc } = await import('firebase/firestore');
  const { compressImageToBase64 } = await import('../../utils/image.js');
  const { icon } = await import('../../utils/icons.js');

  const emojiCategories = {
    'Caritas': ['😊','😂','🤣','😍','😒','😭','😘','🥰','😎','🤩','🤔','🤨','🙄','😏','😴','🤤','😋','😛','😜','🤪','😇','🥳','🥺','😱','😨','😰','😥','😓','😩','😫','😤','😡','😠','🤬','🤢','🤮','🤧','🥵','🥶','🥴','😵','🤯','🤠','🤡','🤫','🤭','🧐','🤓','😈','👿','💀','💩'],
    'Gesto': ['👋','🤚','🖐️','✋','🖖','👌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','✍️','💪','👀','👁️','👂','👄','💋'],
    'Entrega': ['🛵','🚚','🚛','🚲','🏍️','📍','🏁','⛽','🚦','🚧','🗺️','📦','🎁','🏠','🏢','🏪','🛒','🛍️','💰','💵','💳','🧾','⏰','⏳','⏱️','🔋','📶','📱','📞','💬'],
    'Comida': ['🍕','🍔','🍟','🌭','🥪','🌮','🌯','🍳','🥘','🍲','🥣','🥗','🍿','🍱','🍙','🍚','🍛','🍜','🍝','🍠','🍣','🍤','🥟','🍦','🍨','🍩','🍪','🎂','🍰','🍫','🍬','☕','🍵','🥤','🍺','🍻','🍷']
  };

  const overlay = document.createElement('div');
  overlay.id = 'driver-support-chat-modal';
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 100010;
    background: rgba(0,0,0,0.65); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
    display: flex; align-items: flex-end; justify-content: center;
    opacity: 0; transition: opacity 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  `;

  overlay.innerHTML = `
    <div id="driver-support-chat-card" style="
      width: 100%; max-width: 520px; height: 90vh; height: 90dvh;
      background: ${isLight ? '#ffffff' : '#0f172a'};
      border-top-left-radius: 28px; border-top-right-radius: 28px;
      border: 1px solid ${isLight ? '#e2e8f0' : 'rgba(255,255,255,0.12)'};
      display: flex; flex-direction: column; overflow: hidden;
      box-shadow: 0 -10px 40px rgba(0,0,0,0.4);
      transform: translateY(100%); transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      font-family: var(--font-body, sans-serif);
      position: relative;
    ">
      <!-- HEADER -->
      <div style="
        padding: calc(14px + env(safe-area-inset-top, 0px)) 16px 14px;
        background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%);
        color: white; display: flex; align-items: center; justify-content: space-between;
        box-shadow: 0 2px 10px rgba(2,132,199,0.25); z-index: 10;
      ">
        <div style="display:flex; align-items:center; gap:10px;">
          <button id="close-driver-support-chat" aria-label="Volver" style="
            width: 44px; height: 44px;
            background: none; border: none; color: white; cursor: pointer; display: flex; align-items: center; justify-content: center; border-radius: 50%;
          ">
            ${icon('chevronLeft', 24)}
          </button>
          <div style="
            width: 40px; height: 40px; border-radius: 12px;
            background: rgba(255,255,255,0.2); border: 1.5px solid rgba(255,255,255,0.3);
            display: flex; align-items: center; justify-content: center;
            color: white; position: relative; flex-shrink: 0;
          ">
            ${icon('headset', 20)}
            <span style="position:absolute; bottom:-2px; right:-2px; width:11px; height:11px; border-radius:50%; background:#22c55e; border:2px solid #0369a1;"></span>
          </div>
          <div style="min-width:0;">
            <div style="font-size:14.5px; font-weight:900; color:white; display:flex; align-items:center; gap:6px;">
              <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">Soporte GoDelivery</span>
              <span style="font-size:9.5px; background:rgba(255,255,255,0.25); color:white; padding:1px 6px; border-radius:6px; font-weight:900;">EN LÍNEA</span>
            </div>
            <div style="font-size:11px; color:rgba(255,255,255,0.9); font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
              Mesa de Ayuda para Repartidores · Magdalena
            </div>
          </div>
        </div>
      </div>

      <!-- MESSAGES FEED -->
      <div id="driver-support-chat-feed" style="
        flex: 1; overflow-y: auto; padding: 16px 14px; display: flex; flex-direction: column; gap: 10px;
        background: ${isLight ? '#f8fafc' : '#090d16'}; -webkit-overflow-scrolling: touch;
      ">
        <div style="text-align:center; padding:8px 12px; color:var(--driver-text-secondary-inverted); font-size:11.5px; font-weight:600; display:flex; align-items:center; justify-content:center; gap:4px;">
          <span style="display:inline-flex;">${icon('lock', 12)}</span> Conversación directa con los administradores de GoDelivery Magdalena.
        </div>
      </div>

      <!-- EMOJI PICKER POPOVER -->
      <div id="support-emoji-picker" style="
        display: none; height: 210px; background: var(--driver-bg-panel-b);
        border-top: 1.5px solid var(--driver-border-b);
        flex-direction: column; overflow: hidden; z-index: 20;
      ">
        <div id="support-emoji-tabs" style="display:flex; border-bottom:1px solid var(--driver-border-b); background:${isLight ? '#f1f5f9' : '#0f172a'}; overflow-x:auto;">
          ${Object.keys(emojiCategories).map((cat, idx) => `
            <button class="support-cat-btn" data-cat="${cat}" style="
              flex: 1; min-width: 70px; height: 36px; border: none; background: ${idx === 0 ? (isLight ? '#ffffff' : '#1e293b') : 'transparent'};
              color: ${idx === 0 ? '#0284c7' : (isLight ? '#64748b' : '#94a3b8')}; font-weight: 800; font-size: 11.5px; cursor: pointer;
            ">${cat}</button>
          `).join('')}
        </div>
        <div id="support-emoji-grid" style="flex:1; overflow-y:auto; padding:10px; display:grid; grid-template-columns: repeat(auto-fill, minmax(36px, 1fr)); gap:6px; font-size:22px; text-align:center;">
          ${emojiCategories['Caritas'].map(e => `<span class="support-emoji-item" style="cursor:pointer; user-select:none; line-height:36px; transition:transform 0.1s;" onmouseover="this.style.transform='scale(1.25)'" onmouseout="this.style.transform='scale(1)'">${e}</span>`).join('')}
        </div>
      </div>

      <!-- FOOTER / INPUT BAR -->
      <div style="
        padding: 10px 14px calc(10px + env(safe-area-inset-bottom, 10px)) 14px;
        background: var(--driver-bg-panel-b);
        border-top: 1px solid var(--driver-border);
        position: relative;
      ">
        <!-- Audio Recording Overlay -->
        <div id="support-audio-recording-overlay" style="
          display: none; position: absolute; inset: 0;
          background: var(--driver-bg-panel-b);
          align-items: center; justify-content: space-between; padding: 0 16px;
          z-index: 50; border-top: 1.5px solid #0284c7;
        ">
          <div style="display:flex; align-items:center; gap:8px;">
            <div style="width:10px; height:10px; background:#ef4444; border-radius:50%; animation: pulse 1s infinite;"></div>
            <span id="support-audio-timer" style="font-weight:900; font-size:14px; color:var(--driver-text-primary); font-family:var(--font-display, sans-serif);">0:00</span>
          </div>
          <div id="support-audio-slidehint" style="display:flex; align-items:center; gap:4px; color:var(--driver-text-secondary); font-size:12px; font-weight:700; pointer-events:none;">
            <span>‹</span> Desliza a la izquierda para cancelar
          </div>
        </div>

        <div style="display:flex; align-items:center; gap:8px; position:relative;">
          <!-- Emoji Toggle Button -->
          <button id="support-emoji-toggle-btn" style="
            background: none; border: none; color: var(--driver-text-secondary);
            cursor: pointer; display: flex; align-items: center; justify-content: center;
            width: 36px; height: 36px; border-radius: 50%; padding: 0; flex-shrink: 0;
          ">
            ${icon('smile', 22)}
          </button>

          <!-- Camera / Attach Button -->
          <button id="support-attach-btn" style="
            background: none; border: none; color: var(--driver-text-secondary);
            cursor: pointer; display: flex; align-items: center; justify-content: center;
            width: 36px; height: 36px; border-radius: 50%; padding: 0; flex-shrink: 0;
          ">
            ${icon('camera', 22)}
          </button>
          <input type="file" id="support-file-gallery" style="display:none;" accept="image/*" />
          <input type="file" id="support-file-camera" style="display:none;" accept="image/*" capture="environment" />

          <!-- Text Input -->
          <input id="driver-support-chat-input" type="text" placeholder="Escribí un mensaje..." autocomplete="off" style="
            flex: 1; height: 42px; border-radius: 20px;
            border: 1.5px solid var(--driver-border-strong);
            background: ${isLight ? '#f8fafc' : '#090d16'};
            color: var(--driver-text-primary);
            padding: 0 16px; font-size: 13.5px; font-weight: 600; outline: none;
          " />

          <!-- Mic Audio Recorder Button -->
          <button id="support-mic-btn" title="Grabar audio" style="
            background: none; border: none; color: #0284c7;
            cursor: pointer; display: flex; align-items: center; justify-content: center;
            width: 38px; height: 38px; border-radius: 50%; padding: 0; flex-shrink: 0;
            touch-action: none; -webkit-user-select: none; user-select: none;
          ">
            ${icon('mic', 22)}
          </button>

          <!-- Send Button -->
          <button id="driver-support-chat-send-btn" style="
            width: 42px; height: 42px; border-radius: 50%; border: none;
            background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%);
            color: white; cursor: pointer; display: flex; align-items: center; justify-content: center;
            box-shadow: 0 4px 14px rgba(2,132,199,0.35); flex-shrink: 0;
          ">
            ${icon('send', 18)}
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  requestAnimationFrame(() => {
    overlay.style.opacity = '1';
    const card = overlay.querySelector('#driver-support-chat-card');
    if (card) card.style.transform = 'translateY(0)';
  });

  const closeChat = () => {
    overlay.style.opacity = '0';
    const card = overlay.querySelector('#driver-support-chat-card');
    if (card) card.style.transform = 'translateY(100%)';
    setTimeout(() => {
      if (unsub) unsub();
      overlay.remove();
    }, 250);
  };

  overlay.querySelector('#close-driver-support-chat').onclick = closeChat;
  overlay.onclick = (e) => {
    if (e.target === overlay) closeChat();
  };

  const feed = overlay.querySelector('#driver-support-chat-feed');
  const input = overlay.querySelector('#driver-support-chat-input');
  const sendBtn = overlay.querySelector('#driver-support-chat-send-btn');
  const emojiToggleBtn = overlay.querySelector('#support-emoji-toggle-btn');
  const emojiPicker = overlay.querySelector('#support-emoji-picker');
  const emojiTabs = overlay.querySelector('#support-emoji-tabs');
  const emojiGrid = overlay.querySelector('#support-emoji-grid');
  const attachBtn = overlay.querySelector('#support-attach-btn');
  const fileInputGallery = overlay.querySelector('#support-file-gallery');
  const fileInputCamera = overlay.querySelector('#support-file-camera');
  const micBtn = overlay.querySelector('#support-mic-btn');
  const audioIndicator = overlay.querySelector('#support-audio-recording-overlay');
  const audioTimer = overlay.querySelector('#support-audio-timer');

  // EMOJI PICKER HANDLING
  let isEmojiOpen = false;
  if (emojiToggleBtn && emojiPicker) {
    emojiToggleBtn.onclick = (e) => {
      e.stopPropagation();
      isEmojiOpen = !isEmojiOpen;
      emojiPicker.style.display = isEmojiOpen ? 'flex' : 'none';
    };

    emojiTabs.querySelectorAll('.support-cat-btn').forEach(btn => {
      btn.onclick = () => {
        const cat = btn.dataset.cat;
        emojiTabs.querySelectorAll('.support-cat-btn').forEach(b => {
          b.style.background = 'transparent';
          b.style.color = 'var(--driver-text-secondary)';
        });
        btn.style.background = 'var(--driver-bg-panel-b)';
        btn.style.color = '#0284c7';
        emojiGrid.innerHTML = (emojiCategories[cat] || []).map(e => `
          <span class="support-emoji-item" style="cursor:pointer; user-select:none; line-height:36px;">${e}</span>
        `).join('');
        attachEmojiClickEvents();
      };
    });

    const attachEmojiClickEvents = () => {
      emojiGrid.querySelectorAll('.support-emoji-item').forEach(el => {
        el.onclick = () => {
          const char = el.textContent;
          input.value = (input.value || '') + char;
          input.focus();
        };
      });
    };
    attachEmojiClickEvents();
  }

  // ATTACH PHOTO (GALLERY OR CAMERA)
  if (attachBtn) {
    attachBtn.onclick = () => {
      const { showModal, closeModal } = window.__showModal || {};
      import('../../components/modal.js').then(m => {
        m.showModal({
          title: 'Enviar imagen',
          content: `
            <div style="padding: 20px 16px; display: flex; flex-direction: column; gap: 12px; font-family:var(--font-body, sans-serif);">
              <button id="btn-sup-camera" style="
                width: 100%; height: 50px; border-radius: 16px; background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%);
                color: white; border: none; font-weight: 850; font-size: 14px; display: flex; align-items: center; justify-content: center; gap: 8px; cursor: pointer;
              ">
                <span style="display:inline-flex;">${icon('camera', 16)}</span> Tomar Foto (Cámara)
              </button>
              <button id="btn-sup-gallery" style="
                width: 100%; height: 50px; border-radius: 16px; background: var(--driver-fill-subtle);
                border: 1.5px solid var(--driver-border-c); color: var(--driver-text-primary);
                font-weight: 850; font-size: 14px; display: flex; align-items: center; justify-content: center; gap: 8px; cursor: pointer;
              ">
                <span style="display:inline-flex;">${icon('image', 16)}</span> Seleccionar de Galería
              </button>
            </div>
          `,
          height: 'auto',
          hideHeader: true,
          onOpen: () => {
            const btnCam = document.getElementById('btn-sup-camera');
            const btnGal = document.getElementById('btn-sup-gallery');
            if (btnCam) btnCam.onclick = () => { m.closeModal(); fileInputCamera?.click(); };
            if (btnGal) btnGal.onclick = () => { m.closeModal(); fileInputGallery?.click(); };
          }
        });
      });
    };
  }

  const handleSendImage = async (file) => {
    if (!file) return;
    try {
      showToast('Comprimiendo y enviando imagen...', 'info');
      const base64Data = await compressImageToBase64(file, 800, 0.6);
      await sendPayload({
        sender: 'user',
        text: '📷 Foto enviada',
        image: base64Data,
        timestamp: Date.now(),
        userName: driverName
      });
      showToast('Imagen enviada con éxito', 'success');
    } catch (e) {
      console.error('Error sending support image:', e);
      showToast('Error al enviar la imagen', 'error');
    }
  };

  if (fileInputGallery) fileInputGallery.onchange = (e) => handleSendImage(e.target.files[0]);
  if (fileInputCamera) fileInputCamera.onchange = (e) => handleSendImage(e.target.files[0]);

  // VOICE AUDIO RECORDING
  let mediaRecorder = null;
  let audioChunks = [];
  let recordStartTime = 0;
  let recordTimer = null;
  let isRecording = false;
  let startX = 0;
  let isCancelled = false;

  const stopRecording = () => {
    if (isRecording && mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
  };

  const handlePointerMove = (e) => {
    if (!isRecording) return;
    const currentX = e.clientX || (e.touches && e.touches[0] ? e.touches[0].clientX : startX);
    const diffX = startX - currentX;
    if (diffX > 120) {
      isCancelled = true;
      stopRecording();
      showToast('Grabación cancelada', 'warning');
    }
  };

  const handlePointerUp = () => {
    if (isRecording) stopRecording();
  };

  if (micBtn) {
    micBtn.addEventListener('pointerdown', async (e) => {
      e.preventDefault();
      startX = e.clientX || (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
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
            micBtn.style.color = '#ef4444';
            micBtn.style.transform = 'scale(1.2)';

            recordTimer = setInterval(() => {
              const elapsed = Math.floor((Date.now() - recordStartTime) / 1000);
              const m = Math.floor(elapsed / 60);
              const s = (elapsed % 60).toString().padStart(2, '0');
              audioTimer.textContent = `${m}:${s}`;
            }, 1000);

            window.addEventListener('pointermove', handlePointerMove);
            window.addEventListener('pointerup', handlePointerUp);
            window.addEventListener('pointercancel', handlePointerUp);
          };

          mediaRecorder.onstop = async () => {
            isRecording = false;
            clearInterval(recordTimer);
            audioIndicator.style.display = 'none';
            micBtn.style.color = '#0284c7';
            micBtn.style.transform = 'scale(1)';

            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', handlePointerUp);
            window.removeEventListener('pointercancel', handlePointerUp);

            stream.getTracks().forEach(track => track.stop());

            const elapsedMs = Date.now() - recordStartTime;
            if (audioChunks.length > 0 && !isCancelled) {
              if (elapsedMs < 800) {
                showToast('Audio muy corto', 'warning');
                return;
              }

              showToast('Enviando audio...', 'info');
              const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
              const reader = new FileReader();
              reader.onloadend = async () => {
                const base64Audio = reader.result;
                await sendPayload({
                  sender: 'user',
                  text: '🎙 Mensaje de voz',
                  audio: base64Audio,
                  timestamp: Date.now(),
                  userName: driverName
                });
                showToast('Audio enviado con éxito', 'success');
              };
              reader.readAsDataURL(audioBlob);
            }
          };

          mediaRecorder.start();
        } catch (err) {
          console.warn('Microphone permission denied / error:', err);
          showToast('Permiso de micrófono requerido', 'warning');
        }
      } else {
        showToast('Navegador no soporta grabación de voz', 'warning');
      }
    });
  }

  // RENDER MESSAGES WITH PHOTO AND AUDIO SUPPORT
  const renderMessages = (messages = []) => {
    if (!messages || messages.length === 0) {
      feed.innerHTML = `
        <div style="text-align:center; padding:40px 16px; color:var(--driver-text-secondary);">
          <div style="display:flex; justify-content:center; margin-bottom:8px;">${icon('smile', 38)}</div>
          <div style="font-size:15px; font-weight:900; color:var(--driver-text-primary);">¡Hola, ${driverName}!</div>
          <div style="font-size:12.5px; margin-top:4px; line-height:1.45;">¿Tenés algún inconveniente en la calle o duda con tus entregas? Escribinos, enviá audios o fotos y un administrador te responderá a la brevedad.</div>
        </div>
      `;
      return;
    }

    feed.innerHTML = messages.map(m => {
      const isMine = m.sender === 'user' || m.sender === driverId;
      const timeStr = m.timestamp ? new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

      return `
        <div style="display:flex; flex-direction:column; align-items:${isMine ? 'flex-end' : 'flex-start'}; gap:3px; max-width:85%; align-self:${isMine ? 'flex-end' : 'flex-start'};">
          <div style="font-size:10px; font-weight:800; color:${isMine ? (isLight ? '#0284c7' : '#38bdf8') : (isLight ? '#64748b' : '#94a3b8')}; padding:0 4px;">
            ${isMine ? 'Tú (Repartidor)' : `<span style="display:inline-flex; vertical-align:middle;">${icon('crown', 10)}</span> Soporte GoDelivery`}
          </div>
          <div style="
            padding: ${m.image && !m.audio ? '6px 6px 14px 6px' : '10px 14px 14px 14px'};
            border-radius: 18px;
            border-bottom-${isMine ? 'right' : 'left'}-radius: 4px;
            background: ${isMine ? 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)' : (isLight ? '#ffffff' : '#1e293b')};
            color: ${isMine ? '#ffffff' : (isLight ? '#0f172a' : '#ffffff')};
            border: 1px solid ${isMine ? 'transparent' : (isLight ? '#e2e8f0' : 'rgba(255,255,255,0.08)')};
            font-size: 13px; font-weight: 700; line-height: 1.45; word-break: break-word;
            box-shadow: 0 2px 8px rgba(0,0,0,0.06); position: relative; min-width: 110px;
          ">
            ${m.audio ? `
              <div style="display:flex; align-items:center; gap:8px; padding:4px 0 6px;">
                <audio controls src="${m.audio}" style="height:34px; max-width:210px; border-radius:10px; outline:none;"></audio>
              </div>
            ` : m.image ? `
              <img src="${m.image}" style="max-width:100%; max-height:260px; border-radius:14px; display:block; cursor:pointer;" onclick="window.open('${m.image}')" />
              ${m.text && m.text !== '📷 Foto enviada' ? `<div style="margin-top:6px; padding:0 6px;">${m.text}</div>` : ''}
            ` : `
              <div>${m.text}</div>
            `}

            <div style="font-size:9.5px; opacity:0.85; color:${isMine ? 'rgba(255,255,255,0.85)' : (isLight ? '#94a3b8' : '#64748b')}; text-align:right; margin-top:4px;">
              ${timeStr} ${isMine ? '✓✓' : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');

    feed.scrollTop = feed.scrollHeight;
  };

  const chatDocRef = doc(db, 'support_chats', chatId);
  const unsub = onSnapshot(chatDocRef, (snap) => {
    if (snap.exists()) {
      const data = snap.data();
      renderMessages(data.messages || []);
    } else {
      renderMessages([]);
    }
  });

  const sendPayload = async (messageObj) => {
    try {
      const chatSnap = await getDoc(chatDocRef);
      const summaryText = messageObj.audio ? '🎙 Mensaje de voz' : (messageObj.image ? '📷 Foto' : messageObj.text);

      if (!chatSnap.exists()) {
        await setDoc(chatDocRef, {
          userId: driverId,
          userName: driverName,
          userRole: 'driver',
          deliveryId: driverDeliveryId,
          ticketId: `#TK-DRV-${driverDeliveryId}`,
          status: 'pending',
          createdAt: serverTimestamp(),
          lastMessageText: summaryText,
          lastMessageTime: serverTimestamp(),
          unreadByAdmin: true,
          unreadByUser: false,
          messages: [messageObj]
        });
      } else {
        await updateDoc(chatDocRef, {
          status: 'pending',
          lastMessageText: summaryText,
          lastMessageTime: serverTimestamp(),
          unreadByAdmin: true,
          unreadByUser: false,
          messages: arrayUnion(messageObj)
        });
      }

      // Notify all admins in real time
      try {
        const [roleSnap, isAdminSnap] = await Promise.all([
          getDocs(query(collection(db, 'users'), where('role', '==', 'admin'))).catch(() => ({ docs: [] })),
          getDocs(query(collection(db, 'users'), where('isAdmin', '==', true))).catch(() => ({ docs: [] }))
        ]);

        const adminIds = new Set();
        [...roleSnap.docs, ...isAdminSnap.docs].forEach(d => adminIds.add(d.id));

        const notifPromises = [];
        adminIds.forEach(adminId => {
          notifPromises.push(
            addDoc(collection(db, 'users', adminId, 'notifications'), {
              title: '🚨 Mensaje de Repartidor en Ruta',
              body: `${driverName} (${driverDeliveryId}): "${summaryText.slice(0, 80)}"`,
              createdAt: serverTimestamp(),
              type: 'support_ticket',
              status: 'unread',
              clickable: true,
              url: `#/admin/support-chats?ticketId=${chatId}`,
              data: {
                chatId: chatId,
                driverId: driverId
              }
            }).catch(e => console.warn('Admin notif error:', e))
          );
        });
        await Promise.all(notifPromises);
      } catch (errNotif) {
        console.warn('Failed admin dispatch:', errNotif);
      }
    } catch (err) {
      console.error('Error sending support payload:', err);
      showToast('Error al enviar el mensaje', 'error');
    }
  };

  const sendMessage = async () => {
    const text = input.value.trim();
    if (!text) return;

    input.value = '';
    if (emojiPicker) emojiPicker.style.display = 'none';
    isEmojiOpen = false;

    input.disabled = true;
    sendBtn.disabled = true;

    await sendPayload({
      sender: 'user',
      text: text,
      timestamp: Date.now(),
      userName: driverName
    });

    input.disabled = false;
    sendBtn.disabled = false;
    input.focus();
  };

  sendBtn.onclick = sendMessage;
  input.onkeydown = (e) => {
    if (e.key === 'Enter') sendMessage();
  };
  input.focus();
}

