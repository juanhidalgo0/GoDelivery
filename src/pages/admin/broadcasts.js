import { db } from '../../firebase.js';
import { doc, setDoc, collection, getDocs, serverTimestamp } from 'firebase/firestore';
import { isAdmin } from '../../auth.js';
import { icon } from '../../utils/icons.js';
import { getState } from '../../state.js';
import { showToast } from '../../components/toast.js';
import { showConfirm } from '../../components/modal.js';

export async function renderAdminBroadcasts() {
  const content = document.getElementById('app-content');
  if (!content) return;

  if (!isAdmin()) {
    content.innerHTML = `<div class="empty-state"><p>No tenés acceso a esta sección.</p></div>`;
    return;
  }

  content.innerHTML = `
    <div class="panel-page" style="display:flex;flex-direction:column;height:100dvh;width:100%;position:fixed;top:0;left:0;z-index:1000;overflow:hidden;background:var(--color-bg);">
      <!-- Red Premium Header (Integrated) -->
      <div style="background:var(--color-primary); padding:16px 20px; display:flex; align-items:center; justify-content:space-between; gap:16px; flex-shrink:0; position:relative; overflow:hidden; box-shadow:0 4px 12px rgba(var(--color-primary-rgb),0.2); z-index:100;">
        <!-- Decorative Circles -->
        <div style="position: absolute; top: -20px; right: -20px; width: 80px; height: 80px; background: rgba(255,255,255,0.08); border-radius: 50%; pointer-events: none;"></div>
        
        <div style="display:flex;align-items:center;gap:14px;min-width:0;flex:1;position:relative;z-index:2;">
          <a href="#/admin" style="display:flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:12px;background:rgba(255,255,255,0.15);color:white;flex-shrink:0;text-decoration:none;transition:all 0.2s;">${icon('chevronLeft', 24)}</a>
          <div style="min-width:0;flex:1;">
            <h1 style="font-family:var(--font-display);font-weight:900;font-size:20px;color:white;margin:0;line-height:1.2;letter-spacing:-0.02em;">Campañas Push</h1>
            <p style="font-size:11px;color:rgba(255,255,255,0.7);font-weight:800;margin:2px 0 0;text-transform:uppercase;letter-spacing:0.05em;">Lanzador de Mensajes Push</p>
          </div>
        </div>
        <a href="#/admin/broadcasts/history" style="display:flex;align-items:center;justify-content:center;width:40px;height:40px;background:rgba(255,255,255,0.15);color:white;border-radius:12px;transition:all 0.2s;text-decoration:none;position:relative;z-index:2;" title="Ver Historial y Métricas">
          ${icon('trendingUp', 20)}
        </a>
      </div>

      <!-- Scrollable Content -->
      <div style="flex:1;overflow-y:auto;padding:20px;-webkit-overflow-scrolling:touch;">
        <div style="display:flex;flex-direction:column;gap:20px;padding-bottom:40px;max-width:600px;margin:0 auto;">

          <!-- Push Campaign Creator Card -->
          <div style="background:var(--color-surface);border:1px solid var(--color-border);border-radius:24px;padding:20px;box-shadow:var(--shadow-sm);">
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;">
              <div style="width:40px;height:40px;border-radius:12px;background:linear-gradient(135deg,#c084fc,#a855f7);color:white;display:flex;align-items:center;justify-content:center;">${icon('bell', 20)}</div>
              <div>
                <h3 style="font-family:var(--font-display);font-size:16px;font-weight:900;margin:0;color:var(--color-text);">Nueva Campaña Push</h3>
                <p style="font-size:11px;color:var(--color-text-tertiary);margin:2px 0 0;font-weight:600;">Lanzamiento masivo en Magdalena</p>
              </div>
            </div>

            <div style="display:flex;flex-direction:column;gap:14px;margin-bottom:20px;">
              <div>
                <label style="font-weight:700;font-size:11px;margin-bottom:6px;display:block;color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:0.04em;">Segmento de Audiencia</label>
                <select class="input" id="push-audience" style="width:100%;height:48px;border-radius:14px;padding:0 14px;font-weight:700;font-size:14px;background:var(--color-bg-secondary);border:1px solid var(--color-border);color:var(--color-text);cursor:pointer;outline:none;">
                  <option value="all">📢 Todos los Dispositivos</option>
                  <option value="clients">🟢 Solo Clientes</option>
                  <option value="drivers">🚴 Solo Repartidores</option>
                  <option value="stores">🏪 Solo Comercios</option>
                </select>
              </div>

              <div>
                <label style="font-weight:700;font-size:11px;margin-bottom:6px;display:block;color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:0.04em;">Título de la Notificación</label>
                <input type="text" class="input" id="push-title" placeholder="Ej: ¡Gran Descuento de Lluvia! 🌧️" style="width:100%;height:48px;border-radius:14px;padding:0 14px;font-weight:700;font-size:14px;" />
              </div>

              <div>
                <label style="font-weight:700;font-size:11px;margin-bottom:6px;display:block;color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:0.04em;">Cuerpo del Mensaje</label>
                <textarea class="input" id="push-body" placeholder="Escribí acá el cuerpo del mensaje push..." style="width:100%;height:80px;border-radius:14px;padding:12px 14px;font-weight:500;font-size:13px;line-height:1.4;resize:none;"></textarea>
              </div>

              <div>
                <label style="font-weight:700;font-size:11px;margin-bottom:6px;display:block;color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:0.04em;">Banner de Imagen (Formatos ricos)</label>
                <div style="display:flex;gap:10px;margin-bottom:10px;">
                  <button type="button" class="btn" id="btn-upload-push-image" style="flex:1;height:44px;border-radius:12px;font-size:12px;font-weight:800;display:flex;align-items:center;justify-content:center;gap:6px;background:var(--color-bg-secondary);border:1px solid var(--color-border);color:var(--color-text);cursor:pointer;padding:0 12px;">
                    ${icon('uploadCloud', 16)} Subir Imagen
                  </button>
                  <button type="button" class="btn" id="btn-select-commerce-banner" style="flex:1;height:44px;border-radius:12px;font-size:12px;font-weight:800;display:flex;align-items:center;justify-content:center;gap:6px;background:var(--color-bg-secondary);border:1px solid var(--color-border);color:var(--color-text);cursor:pointer;padding:0 12px;">
                    ${icon('store', 16)} Copiar de Comercio
                  </button>
                  <input type="file" id="push-file-input" style="display:none" accept="image/*" />
                </div>
                <input type="text" class="input" id="push-image" placeholder="Pegá una URL de banner o subí uno..." style="width:100%;height:48px;border-radius:14px;padding:0 14px;font-weight:600;font-size:13px;" />
                <div id="push-image-preview-container" style="display:none;position:relative;margin-top:10px;border-radius:16px;overflow:hidden;border:1px solid var(--color-border-light);background:var(--color-bg-secondary);max-height:160px;">
                  <img id="push-image-preview" src="" style="width:100%;height:100%;object-fit:cover;max-height:160px;" />
                  <button type="button" id="btn-remove-push-image" style="position:absolute;top:10px;right:10px;width:30px;height:30px;border-radius:50%;background:rgba(0,0,0,0.6);border:none;color:white;display:flex;align-items:center;justify-content:center;cursor:pointer;backdrop-filter:blur(4px);padding:0;" title="Quitar imagen">
                    ${icon('x', 14)}
                  </button>
                </div>
              </div>

              <div>
                <label style="font-weight:700;font-size:11px;margin-bottom:6px;display:block;color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:0.04em;">Enlace de Acción (URL opcional)</label>
                <div style="display:flex;gap:10px;">
                  <input type="text" class="input" id="push-url" placeholder="Ej: /#/cart" style="flex:1;height:48px;border-radius:14px;padding:0 14px;font-weight:600;font-size:13px;" />
                  <select class="input" id="push-url-preset" style="width:140px;height:48px;border-radius:14px;padding:0 10px;font-weight:700;font-size:13px;background:var(--color-bg-secondary);border:1px solid var(--color-border);color:var(--color-text);cursor:pointer;outline:none;">
                    <option value="">⚙️ Personalizado</option>
                    <option value="/#/">🏠 Inicio</option>
                    <option value="/#/cart">🛒 Carrito</option>
                    <option value="/#/profile/orders">📦 Mis Pedidos</option>
                    <option value="/#/gofavores">🌟 GoFavores</option>
                    <option value="commerce_picker">🏪 Comercio...</option>
                  </select>
                </div>
              </div>
            </div>

            <button class="btn btn-block" id="btn-send-global-push" style="width:100%;height:52px;border-radius:16px;background:linear-gradient(135deg,#c084fc,#a855f7);color:white;border:none;font-weight:900;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;box-shadow:0 8px 20px rgba(168,85,247,0.3);">
              ${icon('send', 18)} ENVIAR CAMPAÑA PUSH
            </button>
          </div>

        </div>
      </div>
    </div>
  `;

  // Local state for the uploaded push banner
  let uploadedImageBase64 = null;

  // Preset URL select helper with interactive commerce picker
  document.getElementById('push-url-preset')?.addEventListener('change', async (e) => {
    const val = e.target.value;
    const urlInput = document.getElementById('push-url');
    if (!urlInput) return;

    if (val === 'commerce_picker') {
      const presetSelect = e.target;
      presetSelect.disabled = true;

      try {
        const { collection, getDocs } = await import('firebase/firestore');
        const snap = await getDocs(collection(db, 'comercios'));
        const commercesList = snap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
        commercesList.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

        const modalContent = document.createElement('div');
        modalContent.style.padding = '10px 10px 20px';
        modalContent.innerHTML = `
          <h3 style="font-family:var(--font-display);font-size:18px;font-weight:900;margin-bottom:6px;text-align:center;">Seleccionar Perfil de Comercio</h3>
          <p style="font-size:11px;color:var(--color-text-tertiary);font-weight:700;text-transform:uppercase;letter-spacing:0.04em;text-align:center;margin-bottom:20px;">
            Elegí un comercio como destino de la notificación
          </p>
          <div style="display:flex;flex-direction:column;gap:12px;max-height:400px;overflow-y:auto;padding-right:4px;">
            ${commercesList.map(c => `
              <div class="com-link-select-item" data-id="${c.id}" data-name="${c.name}" style="display:flex;align-items:center;gap:14px;padding:12px;border:1px solid var(--color-border-light);border-radius:18px;background:var(--color-bg-secondary);cursor:pointer;transition:all 0.15s;text-align:left;">
                <div style="width:40px;height:40px;border-radius:10px;overflow:hidden;border:1px solid var(--color-border-light);background:white;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                  <img src="${c.logo || '/logo.png'}" style="width:100%;height:100%;object-fit:contain;padding:4px;" />
                </div>
                <div style="flex:1;min-width:0;text-align:left;">
                  <div style="font-weight:800;font-size:14px;color:var(--color-text);">${c.name}</div>
                  <div style="font-size:11px;color:var(--color-text-tertiary);font-weight:600;margin-top:2px;">
                    📍 ${c.address || 'Sin dirección'}
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        `;

        const { showModal, closeModal } = await import('../../components/modal.js');
        showModal({
          title: '',
          hideHeader: true,
          height: 'auto',
          content: modalContent
        });

        modalContent.querySelectorAll('.com-link-select-item').forEach(item => {
          item.addEventListener('click', () => {
            const commerceId = item.dataset.id;
            const commerceName = item.dataset.name;
            urlInput.value = `/#/comercio/${commerceId}`;
            closeModal();
            showToast(`Destino configurado: ${commerceName}`, 'success');
          });
        });

      } catch (err) {
        console.error('Error fetching commerce links:', err);
        showToast('Error al cargar comercios', 'error');
      } finally {
        presetSelect.disabled = false;
        presetSelect.value = ''; // Reset select to "Personalizado"
      }
    } else {
      urlInput.value = val;
    }
  });

  // Image preview live thumbnail helper
  const imgInput = document.getElementById('push-image');
  const imgContainer = document.getElementById('push-image-preview-container');
  const imgPreview = document.getElementById('push-image-preview');

  const updatePushImagePreview = (src) => {
    if (src) {
      if (imgPreview) imgPreview.src = src;
      if (imgContainer) imgContainer.style.display = 'block';
    } else {
      if (imgContainer) imgContainer.style.display = 'none';
      if (imgPreview) imgPreview.src = '';
    }
  };

  imgInput?.addEventListener('input', () => {
    const val = imgInput.value.trim();
    if (uploadedImageBase64) {
      uploadedImageBase64 = null;
    }
    if (val && (val.startsWith('http://') || val.startsWith('https://'))) {
      updatePushImagePreview(val);
    } else {
      updatePushImagePreview(null);
    }
  });

  // Trigger file input on click
  document.getElementById('btn-upload-push-image')?.addEventListener('click', () => {
    document.getElementById('push-file-input')?.click();
  });

  // Handle local file selection and cropping
  document.getElementById('push-file-input')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const { openCropper } = await import('../../utils/cropper.js');
      const croppedBase64 = await openCropper(file, {
        aspectRatio: 2,
        maxWidth: 800,
        maxHeight: 400
      });

      uploadedImageBase64 = croppedBase64;
      if (imgInput) imgInput.value = 'Imagen cargada desde dispositivo 📤';
      updatePushImagePreview(croppedBase64);
      showToast('Imagen recortada con éxito', 'success');
    } catch (err) {
      if (err !== 'Cancelled') {
        console.error('Error cropping image:', err);
        showToast('Error al recortar imagen', 'error');
      }
    } finally {
      e.target.value = '';
    }
  });

  // Select banner from any commerce
  document.getElementById('btn-select-commerce-banner')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-select-commerce-banner');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `${icon('loader', 14, 'animate-spin')} Cargando...`;

    try {
      const { collection, getDocs } = await import('firebase/firestore');
      const snap = await getDocs(collection(db, 'comercios'));
      const commercesList = snap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
      commercesList.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

      const modalContent = document.createElement('div');
      modalContent.style.padding = '10px 10px 20px';
      modalContent.innerHTML = `
        <h3 style="font-family:var(--font-display);font-size:18px;font-weight:900;margin-bottom:6px;text-align:center;">Copiar Banner de Comercio</h3>
        <p style="font-size:11px;color:var(--color-text-tertiary);font-weight:700;text-transform:uppercase;letter-spacing:0.04em;text-align:center;margin-bottom:20px;">
          Seleccioná un comercio para utilizar su portada
        </p>
        <div style="display:flex;flex-direction:column;gap:12px;max-height:400px;overflow-y:auto;padding-right:4px;">
          ${commercesList.map(c => {
            const hasBanner = !!c.banner;
            return `
              <div class="com-banner-select-item" data-banner="${c.banner || ''}" style="display:flex;align-items:center;gap:14px;padding:12px;border:1px solid var(--color-border-light);border-radius:18px;background:var(--color-bg-secondary);cursor:${hasBanner ? 'pointer' : 'not-allowed'};opacity:${hasBanner ? '1' : '0.65'};transition:all 0.15s;text-align:left;">
                <div style="width:40px;height:40px;border-radius:10px;overflow:hidden;border:1px solid var(--color-border-light);background:white;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                  <img src="${c.logo || '/logo.png'}" style="width:100%;height:100%;object-fit:contain;padding:4px;" />
                </div>
                <div style="flex:1;min-width:0;text-align:left;">
                  <div style="font-weight:800;font-size:14px;color:var(--color-text);">${c.name}</div>
                  <div style="font-size:11px;color:var(--color-text-tertiary);font-weight:600;margin-top:2px;">
                    ${hasBanner ? `${icon('image', 11)} Banner disponible` : `${icon('alertTriangle', 11)} Sin banner configurado`}
                  </div>
                </div>
                ${hasBanner ? `
                  <div style="width:70px;height:40px;border-radius:8px;overflow:hidden;border:1px solid var(--color-border-light);flex-shrink:0;">
                    <img src="${c.banner}" style="width:100%;height:100%;object-fit:cover;" />
                  </div>
                ` : ''}
              </div>
            `;
          }).join('')}
        </div>
      `;

      const { showModal, closeModal } = await import('../../components/modal.js');
      showModal({
        title: '',
        hideHeader: true,
        height: 'auto',
        content: modalContent
      });

      modalContent.querySelectorAll('.com-banner-select-item').forEach(item => {
        const bannerUrl = item.dataset.banner;
        if (!bannerUrl) return;

        item.addEventListener('click', () => {
          uploadedImageBase64 = null;
          if (imgInput) imgInput.value = bannerUrl;
          updatePushImagePreview(bannerUrl);
          closeModal();
          showToast('Banner de comercio copiado', 'success');
        });
      });

    } catch (err) {
      console.error('Error fetching commerce banners:', err);
      showToast('Error al cargar comercios', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  });

  // Remove push image
  document.getElementById('btn-remove-push-image')?.addEventListener('click', () => {
    uploadedImageBase64 = null;
    if (imgInput) imgInput.value = '';
    updatePushImagePreview(null);
  });

  // Global Push Notification Send
  document.getElementById('btn-send-global-push')?.addEventListener('click', async () => {
    const audience = document.getElementById('push-audience').value;
    const title = document.getElementById('push-title').value.trim();
    const body = document.getElementById('push-body').value.trim();
    const url = document.getElementById('push-url').value.trim();
    const imageUrl = document.getElementById('push-image').value.trim();

    if (!body) {
      showToast('El cuerpo del mensaje es obligatorio', 'error');
      return;
    }

    const audienceLabels = {
      all: 'Todos los dispositivos registrados',
      clients: 'Solo los clientes registrados',
      drivers: 'Solo los repartidores de Magdalena',
      stores: 'Solo los comercios adheridos'
    };

    showConfirm({
      title: '🔔 ENVIAR CAMPAÑA PUSH',
      message: `Estás por lanzar una notificación segmentada.<br><br><strong>Audiencia:</strong> ${audienceLabels[audience]}<br><strong>Título:</strong> ${title || 'Go Delivery'}<br><strong>Mensaje:</strong> ${body}${uploadedImageBase64 || imageUrl ? `<br><strong>Banner:</strong> Sí` : ''}`,
      confirmText: 'SÍ, LANZAR CAMPAÑA',
      onConfirm: async () => {
        const btn = document.getElementById('btn-send-global-push');
        btn.disabled = true;
        btn.innerHTML = `${icon('loader', 16, 'animate-spin')} Enviando campaña...`;

        try {
          const { auth } = await import('../../firebase.js');
          const token = await auth.currentUser?.getIdToken();

          if (!token) throw new Error("No autenticado");

          let finalImageUrl = imageUrl;

          if (uploadedImageBase64) {
            // Direct base64 transfer to cloud function to handle upload securely on the backend
            finalImageUrl = uploadedImageBase64;
          } else if (imageUrl === 'Imagen cargada desde dispositivo 📤') {
            finalImageUrl = '';
          } else if (imageUrl && !imageUrl.startsWith('http://') && !imageUrl.startsWith('https://') && !imageUrl.startsWith('data:')) {
            finalImageUrl = '';
          }

          btn.innerHTML = `${icon('loader', 16, 'animate-spin')} Enviando campaña...`;
          const res = await fetch(`https://sendglobalpush-mkje4ndb5a-uc.a.run.app`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({ title, body, url, audience, imageUrl: finalImageUrl })
          });

          if (!res.ok) {
            const errData = await res.json();
            throw new Error(errData.error || 'Error al enviar');
          }

          const data = await res.json();
          showToast(`¡Campaña enviada con éxito a ${data.sentCount} dispositivos!`, 'success');
          
          // Clear inputs
          document.getElementById('push-title').value = '';
          document.getElementById('push-body').value = '';
          document.getElementById('push-url').value = '';
          if (imgInput) imgInput.value = '';
          uploadedImageBase64 = null;
          updatePushImagePreview(null);

          // Ask the admin if they want to check analytics in the history page
          setTimeout(() => {
            showConfirm({
              title: '📊 ANALÍTICAS DE CAMPAÑA',
              message: 'La campaña fue lanzada. ¿Querés ir a la página de Historial para ver las métricas de recepción y CTR?',
              confirmText: 'SÍ, IR AL HISTORIAL',
              cancelText: 'QUEDARME ACÁ',
              onConfirm: () => {
                window.location.hash = '#/admin/broadcasts/history';
              }
            });
          }, 600);

        } catch (err) {
          console.error('[Global Push] Error:', err);
          showToast(err.message || 'Error al enviar campaña', 'error');
        } finally {
          btn.disabled = false;
          btn.innerHTML = `${icon('send', 18)} ENVIAR CAMPAÑA PUSH`;
        }
      }
    });
  });
}

export async function renderAdminBroadcastsHistory() {
  const content = document.getElementById('app-content');
  if (!content) return;

  if (!isAdmin()) {
    content.innerHTML = `<div class="empty-state"><p>No tenés acceso a esta sección.</p></div>`;
    return;
  }

  content.innerHTML = `
    <div class="panel-page" style="display:flex;flex-direction:column;height:100dvh;width:100%;position:fixed;top:0;left:0;z-index:1000;overflow:hidden;background:var(--color-bg);">
      <!-- Red Premium Header (Integrated) -->
      <div style="background:var(--color-primary); padding:16px 20px; display:flex; align-items:center; justify-content:space-between; gap:16px; flex-shrink:0; position:relative; overflow:hidden; box-shadow:0 4px 12px rgba(var(--color-primary-rgb),0.2); z-index:100;">
        <!-- Decorative Circles -->
        <div style="position: absolute; top: -20px; right: -20px; width: 80px; height: 80px; background: rgba(255,255,255,0.08); border-radius: 50%; pointer-events: none;"></div>
        
        <div style="display:flex;align-items:center;gap:14px;min-width:0;flex:1;position:relative;z-index:2;">
          <a href="#/admin/broadcasts" style="display:flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:12px;background:rgba(255,255,255,0.15);color:white;flex-shrink:0;text-decoration:none;transition:all 0.2s;">${icon('chevronLeft', 24)}</a>
          <div style="min-width:0;flex:1;">
            <h1 style="font-family:var(--font-display);font-weight:900;font-size:20px;color:white;margin:0;line-height:1.2;letter-spacing:-0.02em;">Historial de Campañas</h1>
            <p style="font-size:11px;color:rgba(255,255,255,0.7);font-weight:800;margin:2px 0 0;text-transform:uppercase;letter-spacing:0.05em;">Métricas y Rendimiento CTR</p>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;position:relative;z-index:2;">
          <button type="button" id="btn-clear-broadcasts" style="display:flex;align-items:center;justify-content:center;width:40px;height:40px;background:rgba(255,255,255,0.15);color:white;border:none;border-radius:12px;cursor:pointer;transition:all 0.2s;padding:0;" title="Borrar Historial">
            ${icon('trash', 20)}
          </button>
          <button type="button" id="btn-refresh-broadcasts" style="display:flex;align-items:center;justify-content:center;width:40px;height:40px;background:rgba(255,255,255,0.15);color:white;border:none;border-radius:12px;cursor:pointer;transition:all 0.2s;padding:0;" title="Actualizar Historial">
            ${icon('refreshCw', 20)}
          </button>
        </div>
      </div>

      <!-- Scrollable Content -->
      <div style="flex:1;overflow-y:auto;padding:20px;-webkit-overflow-scrolling:touch;">
        <div style="display:flex;flex-direction:column;gap:20px;padding-bottom:40px;max-width:600px;margin:0 auto;" id="push-campaigns-history-container">
          <!-- Renders dynamically -->
        </div>
      </div>
    </div>
  `;

  // Load history initially
  await loadAndRenderBroadcastsHistory();

  // Bind clear history listener
  document.getElementById('btn-clear-broadcasts')?.addEventListener('click', () => {
    showConfirm({
      title: '🗑️ BORRAR HISTORIAL',
      message: '¿Estás seguro de que deseas eliminar permanentemente todo el historial de campañas? Esta acción no se puede deshacer y borrará todos los reportes analíticos de Firestore.',
      confirmText: 'SÍ, BORRAR TODO',
      cancelText: 'CANCELAR',
      danger: true,
      onConfirm: async () => {
        const btn = document.getElementById('btn-clear-broadcasts');
        if (btn) {
          btn.disabled = true;
          btn.style.opacity = '0.5';
        }
        
        try {
          const { collection, getDocs, deleteDoc, doc } = await import('firebase/firestore');
          const snap = await getDocs(collection(db, 'broadcasts'));
          
          if (snap.empty) {
            showToast('El historial ya está vacío', 'info');
            return;
          }
          
          const deletePromises = snap.docs.map(docSnap => deleteDoc(doc(db, 'broadcasts', docSnap.id)));
          await Promise.all(deletePromises);
          
          showToast('Historial borrado con éxito', 'success');
          await loadAndRenderBroadcastsHistory();
        } catch (err) {
          console.error('Error clearing history:', err);
          showToast('Error al borrar el historial', 'error');
        } finally {
          if (btn) {
            btn.disabled = false;
            btn.style.opacity = '1';
          }
        }
      }
    });
  });

  // Bind refresh listener
  document.getElementById('btn-refresh-broadcasts')?.addEventListener('click', loadAndRenderBroadcastsHistory);
}

async function loadAndRenderBroadcastsHistory() {
  const container = document.getElementById('push-campaigns-history-container');
  if (!container) return;

  const refreshBtn = document.getElementById('btn-refresh-broadcasts');
  if (refreshBtn) {
    refreshBtn.style.pointerEvents = 'none';
    refreshBtn.style.opacity = '0.6';
    refreshBtn.innerHTML = `${icon('loader', 20, 'animate-spin')}`;
  }

  try {
    const { collection, getDocs, query, orderBy } = await import('firebase/firestore');
    const q = query(collection(db, 'broadcasts'), orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);

    if (snap.empty) {
      container.innerHTML = `
        <div style="text-align:center;padding:40px;background:var(--color-surface);border-radius:24px;border:1px dashed var(--color-border);color:var(--color-text-tertiary);font-size:13px;font-weight:600;margin-top:10px;">
          No hay campañas de notificaciones enviadas aún.
        </div>
      `;
      return;
    }

    const listHtml = snap.docs.map(docSnap => {
      const b = docSnap.data();
      const clicks = b.clicks || 0;
      const sentCount = b.sentCount || 0;
      const ctr = sentCount > 0 ? ((clicks / sentCount) * 100).toFixed(1) : '0.0';
      const date = b.createdAt?.toDate ? b.createdAt.toDate().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'Reciente';

      const audienceNames = {
        all: '📢 Todos',
        clients: '🟢 Clientes',
        drivers: '🚴 Repartidores',
        stores: '🏪 Comercios'
      };

      const progressColor = ctr > 15 ? 'var(--color-success)' : ctr > 5 ? 'var(--color-primary)' : 'var(--color-text-tertiary)';

      return `
        <div style="background:var(--color-surface);border:1px solid var(--color-border);border-radius:24px;padding:20px;display:flex;flex-direction:column;gap:12px;text-align:left;box-shadow:var(--shadow-sm);">
          <div style="display:flex;justify-content:space-between;align-items:start;gap:12px;">
            <div style="min-width:0;flex:1;">
              <h5 style="font-family:var(--font-display);font-size:15px;font-weight:900;color:var(--color-text);margin:0;letter-spacing:-0.01em;">${b.title || 'Go Delivery'}</h5>
              <p style="font-size:12.5px;color:var(--color-text-secondary);margin:6px 0 0;line-height:1.45;word-break:break-word;">${b.body}</p>
            </div>
            <span style="font-size:10px;background:var(--color-bg-secondary);border:1px solid var(--color-border);color:var(--color-text-secondary);padding:4px 10px;border-radius:8px;font-weight:800;white-space:nowrap;text-transform:uppercase;letter-spacing:0.04em;">${audienceNames[b.targetAudience] || 'Público'}</span>
          </div>

          ${b.imageUrl ? `
            <div style="border-radius:14px;overflow:hidden;border:1px solid var(--color-border-light);height:120px;width:100%;margin-top:4px;">
              <img src="${b.imageUrl}" style="width:100%;height:100%;object-fit:cover;" />
            </div>
          ` : ''}

          <div style="border-top:1px dashed var(--color-border-light);padding-top:12px;display:flex;align-items:center;justify-content:space-between;font-size:11px;font-weight:800;color:var(--color-text-tertiary);">
            <span>📅 ${date}</span>
            <span>🎯 CTR: <strong style="color:${progressColor};font-size:13px;">${ctr}%</strong></span>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;background:var(--color-bg-secondary);border:1px solid var(--color-border);padding:10px 14px;border-radius:16px;text-align:center;">
            <div>
              <div style="font-size:9px;color:var(--color-text-tertiary);text-transform:uppercase;font-weight:800;letter-spacing:0.05em;">Enviado</div>
              <div style="font-size:16px;font-weight:900;color:var(--color-text);margin-top:2px;">${sentCount}</div>
            </div>
            <div style="border-left:1px solid var(--color-border);">
              <div style="font-size:9px;color:var(--color-text-tertiary);text-transform:uppercase;font-weight:800;letter-spacing:0.05em;">Clics</div>
              <div style="font-size:16px;font-weight:900;color:var(--color-primary);margin-top:2px;">${clicks}</div>
            </div>
          </div>

          <div style="width:100%;height:8px;background:var(--color-bg-secondary);border-radius:4px;overflow:hidden;margin-top:4px;border:1px solid var(--color-border-light);">
            <div style="width:${Math.min(100, Number(ctr))}%;height:100%;background:${progressColor};border-radius:4px;transition:width 0.5s ease;"></div>
          </div>
        </div>
      `;
    }).join('');

    container.innerHTML = `<div style="display:flex;flex-direction:column;gap:16px;">${listHtml}</div>`;
  } catch (err) {
    console.error('Error fetching broadcasts history:', err);
    container.innerHTML = `
      <div style="text-align:center;padding:24px;color:var(--color-danger);font-size:13px;font-weight:800;background:var(--color-surface);border:1px solid var(--color-border);border-radius:24px;">
        ⚠️ Error al cargar el historial de campañas. Por favor, intentá nuevamente.
      </div>
    `;
  } finally {
    if (refreshBtn) {
      refreshBtn.style.pointerEvents = 'auto';
      refreshBtn.style.opacity = '1';
      refreshBtn.innerHTML = `${icon('refreshCw', 20)}`;
    }
  }
}
