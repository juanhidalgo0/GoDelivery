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
      <div style="background:var(--color-primary); padding:calc(16px + env(safe-area-inset-top, 0px)) 20px 16px; display:flex; align-items:center; justify-content:space-between; gap:16px; flex-shrink:0; position:relative; overflow:hidden; box-shadow:0 4px 12px rgba(var(--color-primary-rgb),0.2); z-index:100;">
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
        <div style="display:flex;flex-direction:column;gap:18px;padding-bottom:40px;max-width:600px;margin:0 auto;">

          <!-- Navigation Sub-Tabs -->
          <div style="display:flex;align-items:center;background:var(--color-bg-secondary);border:1px solid var(--color-border);border-radius:16px;padding:4px;gap:4px;">
            <a href="#/admin/broadcasts" style="flex:1;text-align:center;padding:10px 4px;font-size:12px;font-weight:850;border-radius:12px;text-decoration:none;display:flex;align-items:center;justify-content:center;gap:6px;background:var(--color-primary);color:white;box-shadow:0 4px 12px rgba(225,29,72,0.25);">
              <span>📢</span> Manual / Prog.
            </a>
            <a href="#/admin/broadcasts/automations" style="flex:1;text-align:center;padding:10px 4px;font-size:12px;font-weight:850;border-radius:12px;text-decoration:none;display:flex;align-items:center;justify-content:center;gap:6px;color:var(--color-text-secondary);background:transparent;">
              <span>🤖</span> Automáticas
            </a>
            <a href="#/admin/broadcasts/history" style="flex:1;text-align:center;padding:10px 4px;font-size:12px;font-weight:850;border-radius:12px;text-decoration:none;display:flex;align-items:center;justify-content:center;gap:6px;color:var(--color-text-secondary);background:transparent;">
              <span>📊</span> Historial
            </a>
          </div>

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
                <label style="font-weight:700;font-size:11px;margin-bottom:6px;display:block;color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:0.04em;">Enlace de Acción (Destino al clickear)</label>
                <div style="display:flex;gap:10px;">
                  <input type="text" class="input" id="push-url" placeholder="Ej: /#/cart" style="flex:1;height:48px;border-radius:14px;padding:0 14px;font-weight:600;font-size:13px;" />
                  <select class="input" id="push-url-preset" style="width:145px;height:48px;border-radius:14px;padding:0 10px;font-weight:700;font-size:12.5px;background:var(--color-bg-secondary);border:1px solid var(--color-border);color:var(--color-text);cursor:pointer;outline:none;">
                    <option value="">⚙️ Personalizado</option>
                    <option value="/#/">🏠 Inicio</option>
                    <option value="/#/offers">🏷️ Ofertas del Día</option>
                    <option value="/#/cart">🛒 Carrito</option>
                    <option value="/#/profile/orders">📦 Mis Pedidos</option>
                    <option value="/#/gofavores">🌟 GoFavores</option>
                    <option value="/#/mis-chats">💬 Mis Chats</option>
                    <option value="category_picker">🍔 Categoría...</option>
                    <option value="commerce_picker">🏪 Comercio...</option>
                  </select>
                </div>
              </div>

              <div>
                <label style="font-weight:700;font-size:11px;margin-bottom:6px;display:block;color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:0.04em;">Programar Envío</label>
                <div style="display:flex; flex-direction:column; gap:8px;">
                  <select class="input" id="push-schedule-mode" style="width:100%;height:48px;border-radius:14px;padding:0 14px;font-weight:700;font-size:14px;background:var(--color-bg-secondary);border:1px solid var(--color-border);color:var(--color-text);cursor:pointer;outline:none;">
                    <option value="now">⚡ Enviar Ahora</option>
                    <option value="scheduled">📅 Programar para Fecha/Hora</option>
                  </select>
                  <input type="datetime-local" class="input" id="push-scheduled-time" style="display:none;width:100%;height:48px;border-radius:14px;padding:0 14px;font-weight:600;font-size:14px;" />
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

  document.getElementById('push-schedule-mode')?.addEventListener('change', (e) => {
    const timeInput = document.getElementById('push-scheduled-time');
    if (timeInput) {
      const isSched = e.target.value === 'scheduled';
      timeInput.style.display = isSched ? 'block' : 'none';
      if (isSched) {
        // Set default to 10 minutes in the future
        const now = new Date(Date.now() + 10 * 60 * 1000);
        now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
        timeInput.value = now.toISOString().slice(0, 16);
        
        const minNow = new Date();
        minNow.setMinutes(minNow.getMinutes() - minNow.getTimezoneOffset());
        timeInput.min = minNow.toISOString().slice(0, 16);
      }
    }
  });

  // Preset URL select helper with interactive commerce and category pickers
  document.getElementById('push-url-preset')?.addEventListener('change', async (e) => {
    const val = e.target.value;
    const urlInput = document.getElementById('push-url');
    if (!urlInput) return;

    if (val === 'category_picker') {
      const presetSelect = e.target;
      presetSelect.disabled = true;
      try {
        const categories = [
          { name: 'Comida', label: '🍔 Comida y Restaurantes', icon: 'utensils' },
          { name: 'Kiosco', label: '🛒 Kiosco y Almacén', icon: 'shoppingBag' },
          { name: 'Bebidas', label: '🥤 Bebidas y Cervezas', icon: 'glassWater' },
          { name: 'Heladeria', label: '🍦 Heladerías y Postres', icon: 'iceCream' },
          { name: 'Farmacia', label: '💊 Farmacia y Cuidado', icon: 'cross' },
          { name: 'Supermercado', label: '🥩 Carnicería y Supermercado', icon: 'store' },
          { name: 'Recomendados', label: '⭐ Destacados y Recomendados', icon: 'sparkles' }
        ];

        const modalContent = document.createElement('div');
        modalContent.style.padding = '10px 10px 20px';
        modalContent.innerHTML = `
          <h3 style="font-family:var(--font-display);font-size:18px;font-weight:900;margin-bottom:6px;text-align:center;">Seleccionar Categoría</h3>
          <p style="font-size:11px;color:var(--color-text-tertiary);font-weight:700;text-transform:uppercase;letter-spacing:0.04em;text-align:center;margin-bottom:20px;">
            Elegí una categoría como destino de la notificación
          </p>
          <div style="display:flex;flex-direction:column;gap:10px;max-height:400px;overflow-y:auto;padding-right:4px;">
            ${categories.map(cat => `
              <div class="cat-link-select-item" data-cat="${cat.name}" style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border:1px solid var(--color-border-light);border-radius:16px;background:var(--color-bg-secondary);cursor:pointer;transition:all 0.15s;">
                <div style="font-weight:800;font-size:14px;color:var(--color-text);">${cat.label}</div>
                <div style="color:var(--color-primary);">${icon('chevronRight', 16)}</div>
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

        modalContent.querySelectorAll('.cat-link-select-item').forEach(item => {
          item.addEventListener('click', () => {
            const catName = item.dataset.cat;
            urlInput.value = `/#/category/${catName}`;
            closeModal();
            showToast(`Destino configurado: Categoría ${catName}`, 'success');
          });
        });

      } catch (err) {
        console.error('Error opening category picker:', err);
      } finally {
        presetSelect.disabled = false;
        presetSelect.value = '';
      }
    } else if (val === 'commerce_picker') {
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
          <h3 style="font-family:var(--font-display);font-size:18px;font-weight:900;margin-bottom:6px;text-align:center;">Seleccionar Comercio</h3>
          <p style="font-size:11px;color:var(--color-text-tertiary);font-weight:700;text-transform:uppercase;letter-spacing:0.04em;text-align:center;margin-bottom:14px;">
            Elegí un comercio como destino de la notificación
          </p>
          <input type="text" id="com-search-filter" placeholder="Buscar comercio..." style="width:100%;height:42px;border-radius:12px;padding:0 12px;font-size:13px;border:1px solid var(--color-border);background:var(--color-bg);color:var(--color-text);margin-bottom:12px;outline:none;" />
          <div id="com-picker-list" style="display:flex;flex-direction:column;gap:10px;max-height:360px;overflow-y:auto;padding-right:4px;">
            ${commercesList.map(c => `
              <div class="com-link-select-item" data-id="${c.id}" data-name="${c.name}" style="display:flex;align-items:center;gap:12px;padding:10px 12px;border:1px solid var(--color-border-light);border-radius:16px;background:var(--color-bg-secondary);cursor:pointer;transition:all 0.15s;text-align:left;">
                <div style="width:38px;height:38px;border-radius:10px;overflow:hidden;border:1px solid var(--color-border-light);background:white;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                  <img src="${c.logo || '/logo.png'}" style="width:100%;height:100%;object-fit:contain;padding:3px;" />
                </div>
                <div style="flex:1;min-width:0;text-align:left;">
                  <div style="font-weight:800;font-size:13.5px;color:var(--color-text);">${c.name}</div>
                  <div style="font-size:10.5px;color:var(--color-text-tertiary);font-weight:600;">
                    ${c.category || 'Comercio'} • ${c.address || 'Magdalena'}
                  </div>
                </div>
                <div style="color:var(--color-primary);">${icon('chevronRight', 16)}</div>
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

        const filterInput = modalContent.querySelector('#com-search-filter');
        filterInput?.addEventListener('input', () => {
          const q = filterInput.value.toLowerCase().trim();
          modalContent.querySelectorAll('.com-link-select-item').forEach(el => {
            const name = (el.dataset.name || '').toLowerCase();
            el.style.display = name.includes(q) ? 'flex' : 'none';
          });
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
        maxWidth: 500,
        maxHeight: 250,
        quality: 0.50
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
        <h3 style="font-family:var(--font-display);font-size:18px;font-weight:900;margin-bottom:6px;text-align:center;">Copiar Imagen de Comercio</h3>
        <p style="font-size:11px;color:var(--color-text-tertiary);font-weight:700;text-transform:uppercase;letter-spacing:0.04em;text-align:center;margin-bottom:14px;">
          Seleccioná un comercio para utilizar su imagen en el banner push
        </p>
        <input type="text" id="com-img-search-filter" placeholder="Buscar comercio..." style="width:100%;height:42px;border-radius:12px;padding:0 12px;font-size:13px;border:1px solid var(--color-border);background:var(--color-bg);color:var(--color-text);margin-bottom:12px;outline:none;" />
        <div id="com-img-picker-list" style="display:flex;flex-direction:column;gap:10px;max-height:360px;overflow-y:auto;padding-right:4px;">
          ${commercesList.map(c => {
            const imageToUse = c.banner || c.logo || '';
            const hasImg = !!imageToUse;
            return `
              <div class="com-banner-select-item" data-id="${c.id}" data-name="${c.name}" data-img="${imageToUse}" style="display:flex;align-items:center;gap:12px;padding:10px 12px;border:1px solid var(--color-border-light);border-radius:16px;background:var(--color-bg-secondary);cursor:${hasImg ? 'pointer' : 'not-allowed'};opacity:${hasImg ? '1' : '0.6'};transition:all 0.15s;text-align:left;">
                <div style="width:40px;height:40px;border-radius:10px;overflow:hidden;border:1px solid var(--color-border-light);background:white;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                  <img src="${c.logo || '/logo.png'}" style="width:100%;height:100%;object-fit:contain;padding:2px;" />
                </div>
                <div style="flex:1;min-width:0;text-align:left;">
                  <div style="font-weight:800;font-size:13.5px;color:var(--color-text);">${c.name}</div>
                  <div style="font-size:10.5px;color:var(--color-text-tertiary);font-weight:600;">
                    ${c.banner ? '📸 Portada disponible' : (c.logo ? '🏷️ Logo disponible' : '⚠️ Sin imagen')}
                  </div>
                </div>
                ${hasImg ? `
                  <div style="width:60px;height:38px;border-radius:8px;overflow:hidden;border:1px solid var(--color-border-light);flex-shrink:0;background:var(--color-surface);">
                    <img src="${imageToUse}" style="width:100%;height:100%;object-fit:cover;" />
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

      const filterInput = modalContent.querySelector('#com-img-search-filter');
      filterInput?.addEventListener('input', () => {
        const q = filterInput.value.toLowerCase().trim();
        modalContent.querySelectorAll('.com-banner-select-item').forEach(el => {
          const name = (el.dataset.name || '').toLowerCase();
          el.style.display = name.includes(q) ? 'flex' : 'none';
        });
      });

      modalContent.querySelectorAll('.com-banner-select-item').forEach(item => {
        const imgUrl = item.dataset.img;
        if (!imgUrl) return;

        item.addEventListener('click', () => {
          if (imgUrl.startsWith('data:image/')) {
            uploadedImageBase64 = imgUrl;
            if (imgInput) imgInput.value = 'Imagen de comercio (Base64) 🏪';
          } else {
            uploadedImageBase64 = null;
            if (imgInput) imgInput.value = imgUrl;
          }
          updatePushImagePreview(imgUrl);
          closeModal();
          showToast(`Imagen copiada de ${item.dataset.name}`, 'success');
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
    const scheduleMode = document.getElementById('push-schedule-mode').value;
    const scheduledTimeVal = document.getElementById('push-scheduled-time').value;

    if (!body) {
      showToast('El cuerpo del mensaje es obligatorio', 'error');
      return;
    }

    let scheduledAt = null;
    if (scheduleMode === 'scheduled') {
      if (!scheduledTimeVal) {
        showToast('Debés ingresar la fecha y hora de programación', 'error');
        return;
      }
      const schedDate = new Date(scheduledTimeVal);
      if (isNaN(schedDate.getTime())) {
        showToast('Fecha de programación inválida', 'error');
        return;
      }
      if (schedDate.getTime() <= Date.now() + 30000) {
        showToast('La fecha de programación debe ser al menos 1 minuto en el futuro', 'error');
        return;
      }
      scheduledAt = schedDate.toISOString();
    }

    const audienceLabels = {
      all: 'Todos los dispositivos registrados',
      clients: 'Solo los clientes registrados',
      drivers: 'Solo los repartidores de Magdalena',
      stores: 'Solo los comercios adheridos'
    };

    const timeLabel = scheduleMode === 'scheduled' 
      ? `<br><strong>Programado para:</strong> ${new Date(scheduledTimeVal).toLocaleString('es-AR')}`
      : '<br><strong>Envío:</strong> Inmediato';

    showConfirm({
      title: scheduleMode === 'scheduled' ? '📅 PROGRAMAR CAMPAÑA PUSH' : '🔔 ENVIAR CAMPAÑA PUSH',
      message: `Estás por ${scheduleMode === 'scheduled' ? 'programar' : 'lanzar'} una notificación segmentada.<br><br><strong>Audiencia:</strong> ${audienceLabels[audience]}<br><strong>Título:</strong> ${title || 'Go Delivery'}<br><strong>Mensaje:</strong> ${body}${uploadedImageBase64 || imageUrl ? `<br><strong>Banner:</strong> Sí` : ''}${timeLabel}`,
      confirmText: scheduleMode === 'scheduled' ? 'SÍ, PROGRAMAR' : 'SÍ, LANZAR CAMPAÑA',
      onConfirm: async () => {
        const btn = document.getElementById('btn-send-global-push');
        btn.disabled = true;
        btn.innerHTML = `${icon('loader', 16, 'animate-spin')} Procesando...`;

        try {
          const { auth } = await import('../../firebase.js');
          const token = await auth.currentUser?.getIdToken();

          if (!token) throw new Error("No autenticado");

          let finalImageUrl = imageUrl;

          const isBase64 = (uploadedImageBase64 && uploadedImageBase64.startsWith('data:image/'))
                        || (imageUrl && imageUrl.startsWith('data:image/'));

          if (isBase64) {
            const rawBase64 = uploadedImageBase64 || imageUrl;
            btn.innerHTML = `${icon('loader', 16, 'animate-spin')} Subiendo imagen a Storage...`;
            try {
              const { ref, uploadBytes, getDownloadURL } = await import('firebase/storage');
              const { storage } = await import('../../firebase.js');
              const storageRef = ref(storage, `broadcasts/${Date.now()}.jpg`);
              
              // Helper to convert base64 to Blob
              const base64ToBlob = (b64) => {
                const parts = b64.split(',');
                const mimeMatch = parts[0].match(/:(.*?);/);
                const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
                const byteCharacters = atob(parts[1]);
                const byteNumbers = new Array(byteCharacters.length);
                for (let i = 0; i < byteCharacters.length; i++) {
                  byteNumbers[i] = byteCharacters.charCodeAt(i);
                }
                const byteArray = new Uint8Array(byteNumbers);
                return new Blob([byteArray], { type: mimeType });
              };
              
              const blob = base64ToBlob(rawBase64);
              await uploadBytes(storageRef, blob);
              finalImageUrl = await getDownloadURL(storageRef);
            } catch (storageErr) {
              console.error('Error uploading image to storage:', storageErr);
              throw new Error('Error al subir la imagen al servidor');
            }
          } else if (imageUrl === 'Imagen cargada desde dispositivo 📤' || imageUrl === 'Imagen de comercio (Base64) 🏪') {
            finalImageUrl = '';
          } else if (imageUrl && (imageUrl.startsWith('http://') || imageUrl.startsWith('https://'))) {
            finalImageUrl = imageUrl;
          } else if (imageUrl && imageUrl.startsWith('/')) {
            finalImageUrl = `${window.location.origin}${imageUrl}`;
          } else {
            finalImageUrl = '';
          }

          btn.innerHTML = `${icon('loader', 16, 'animate-spin')} ${scheduleMode === 'scheduled' ? 'Programando...' : 'Enviando...'}`;
          const res = await fetch(`https://sendglobalpush-mkje4ndb5a-uc.a.run.app`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({ title, body, url, audience, imageUrl: finalImageUrl, scheduledAt })
          });

          if (!res.ok) {
            const errData = await res.json();
            throw new Error(errData.error || 'Error al procesar');
          }

          const data = await res.json();
          if (data.scheduled) {
            showToast('¡Campaña programada con éxito!', 'success');
          } else {
            showToast(`¡Campaña enviada con éxito a ${data.sentCount} dispositivos!`, 'success');
          }
          
          // Clear inputs
          document.getElementById('push-title').value = '';
          document.getElementById('push-body').value = '';
          document.getElementById('push-url').value = '';
          document.getElementById('push-schedule-mode').value = 'now';
          const timeInput = document.getElementById('push-scheduled-time');
          if (timeInput) {
            timeInput.style.display = 'none';
            timeInput.value = '';
          }
          if (imgInput) imgInput.value = '';
          uploadedImageBase64 = null;
          updatePushImagePreview(null);

          // Ask the admin if they want to check analytics in the history page
          setTimeout(() => {
            showConfirm({
              title: '📊 HISTORIAL DE CAMPAÑAS',
              message: data.scheduled 
                ? 'La campaña quedó programada. ¿Querés ir a la página de Historial para ver tus campañas activas y programadas?'
                : 'La campaña fue procesada. ¿Querés ir a la página de Historial para ver las métricas de recepción y CTR?',
              confirmText: 'SÍ, IR AL HISTORIAL',
              cancelText: 'QUEDARME ACÁ',
              onConfirm: () => {
                window.location.hash = '#/admin/broadcasts/history';
              }
            });
          }, 600);

        } catch (err) {
          console.error('[Global Push] Error:', err);
          showToast(err.message || 'Error al procesar campaña', 'error');
        } finally {
          btn.disabled = false;
          btn.innerHTML = `${icon('send', 18)} ENVIAR CAMPAÑA PUSH`;
        }
      }
    });
  });
}

export async function renderAdminBroadcastsAutomations() {
  const content = document.getElementById('app-content');
  if (!content) return;

  if (!isAdmin()) {
    content.innerHTML = `<div class="empty-state"><p>No tenés acceso a esta sección.</p></div>`;
    return;
  }

  content.innerHTML = `
    <div class="panel-page" style="display:flex;flex-direction:column;height:100dvh;width:100%;position:fixed;top:0;left:0;z-index:1000;overflow:hidden;background:var(--color-bg);">
      <!-- Red Premium Header (Integrated) -->
      <div style="background:var(--color-primary); padding:calc(16px + env(safe-area-inset-top, 0px)) 20px 16px; display:flex; align-items:center; justify-content:space-between; gap:16px; flex-shrink:0; position:relative; overflow:hidden; box-shadow:0 4px 12px rgba(var(--color-primary-rgb),0.2); z-index:100;">
        <!-- Decorative Circles -->
        <div style="position: absolute; top: -20px; right: -20px; width: 80px; height: 80px; background: rgba(255,255,255,0.08); border-radius: 50%; pointer-events: none;"></div>
        
        <div style="display:flex;align-items:center;gap:14px;min-width:0;flex:1;position:relative;z-index:2;">
          <a href="#/admin" style="display:flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:12px;background:rgba(255,255,255,0.15);color:white;flex-shrink:0;text-decoration:none;transition:all 0.2s;">${icon('chevronLeft', 24)}</a>
          <div style="min-width:0;flex:1;">
            <h1 style="font-family:var(--font-display);font-weight:900;font-size:20px;color:white;margin:0;line-height:1.2;letter-spacing:-0.02em;">Automatizaciones Push</h1>
            <p style="font-size:11px;color:rgba(255,255,255,0.7);font-weight:800;margin:2px 0 0;text-transform:uppercase;letter-spacing:0.05em;">Gatillos y Horarios Automáticos</p>
          </div>
        </div>
      </div>

      <!-- Scrollable Content -->
      <div style="flex:1;overflow-y:auto;padding:20px;-webkit-overflow-scrolling:touch;">
        <div style="display:flex;flex-direction:column;gap:18px;padding-bottom:40px;max-width:600px;margin:0 auto;">

          <!-- Navigation Sub-Tabs -->
          <div style="display:flex;align-items:center;background:var(--color-bg-secondary);border:1px solid var(--color-border);border-radius:16px;padding:4px;gap:4px;">
            <a href="#/admin/broadcasts" style="flex:1;text-align:center;padding:10px 4px;font-size:12px;font-weight:850;border-radius:12px;text-decoration:none;display:flex;align-items:center;justify-content:center;gap:6px;color:var(--color-text-secondary);background:transparent;">
              <span>📢</span> Manual / Prog.
            </a>
            <a href="#/admin/broadcasts/automations" style="flex:1;text-align:center;padding:10px 4px;font-size:12px;font-weight:850;border-radius:12px;text-decoration:none;display:flex;align-items:center;justify-content:center;gap:6px;background:var(--color-primary);color:white;box-shadow:0 4px 12px rgba(225,29,72,0.25);">
              <span>🤖</span> Automáticas
            </a>
            <a href="#/admin/broadcasts/history" style="flex:1;text-align:center;padding:10px 4px;font-size:12px;font-weight:850;border-radius:12px;text-decoration:none;display:flex;align-items:center;justify-content:center;gap:6px;color:var(--color-text-secondary);background:transparent;">
              <span>📊</span> Historial
            </a>
          </div>

          <!-- Info Banner -->
          <div style="background:rgba(168,85,247,0.08);border:1px solid rgba(168,85,247,0.2);border-radius:20px;padding:14px 16px;display:flex;align-items:start;gap:12px;">
            <div style="font-size:22px;line-height:1;margin-top:2px;">💡</div>
            <div style="font-size:12px;line-height:1.45;color:var(--color-text-secondary);">
              <strong style="color:var(--color-text);display:block;font-size:13px;margin-bottom:2px;">Gatillos automáticos inteligentes</strong>
              El servidor evalúa cada minuto las reglas activas y envía la notificación a los usuarios exactamente en los momentos de mayor deseo de consumo. Podés personalizar horarios, días, mensajes y activar o pausar cada una.
            </div>
          </div>

          <!-- Automations List Container -->
          <div id="automations-list-container" style="display:flex;flex-direction:column;gap:18px;">
            <div style="text-align:center;padding:40px;color:var(--color-text-tertiary);">
              ${icon('loader', 24, 'animate-spin')}
            </div>
          </div>

        </div>
      </div>
    </div>
  `;

  await loadAndRenderAutomations();
}

async function loadAndRenderAutomations() {
  const container = document.getElementById('automations-list-container');
  if (!container) return;

  const defaultAutomations = [
    {
      id: 'lunch_daily',
      name: 'Almuerzo Diario',
      icon: '🍔',
      description: 'Aviso antes del mediodía para impulsar pedidos de almuerzo sin cocinar.',
      enabled: true,
      days: [1, 2, 3, 4, 5, 6, 0],
      time: '12:00',
      title: '¿Qué comemos hoy al mediodía? 🍔',
      body: 'Pedí tu almuerzo favorito caliente y sin moverte de tu casa ni cocinar.',
      url: '/#/category/Comida',
      targetAudience: 'clients'
    },
    {
      id: 'dinner_weekend',
      name: 'Cena Fin de Semana',
      icon: '🍕',
      description: 'Disparo nocturno para cenas de viernes, sábados y domingos.',
      enabled: true,
      days: [5, 6, 0],
      time: '20:30',
      title: '¡Arrancó la noche en GoDelivery! 🍕🍻',
      body: 'Pizzas, empanadas, hamburguesas y bebidas frías con entrega rápida a tu puerta.',
      url: '/#/category/Comida',
      targetAudience: 'clients'
    },
    {
      id: 'mate_afternoon',
      name: 'Merienda y Helados',
      icon: '☕',
      description: 'Aviso vespertino para antojos de la tarde, facturas, panadería y helados.',
      enabled: true,
      days: [1, 2, 3, 4, 5, 6, 0],
      time: '16:45',
      title: 'Hora del mate y la merienda ☕🍦',
      body: 'Facturas recién horneadas, cosas ricas de panadería y helados listos para salir.',
      url: '/#/category/Heladeria',
      targetAudience: 'clients'
    },
    {
      id: 'cart_abandoned',
      name: 'Carrito Abandonado',
      icon: '🛒',
      description: 'Recordatorio vespertino para usuarios con productos en el carrito.',
      enabled: true,
      days: [1, 2, 3, 4, 5, 6, 0],
      time: '19:45',
      title: 'Te olvidaste algo rico en tu carrito 🛒',
      body: 'Tus productos te están esperando. Completá tu pedido antes de que cierren los locales.',
      url: '/#/cart',
      targetAudience: 'clients'
    },
    {
      id: 'inactive_users',
      name: 'Reactivación Semanal',
      icon: '👋',
      description: 'Impulso semanal para recordar novedades a usuarios inactivos.',
      enabled: false,
      days: [4], // Jueves
      time: '19:30',
      title: '¡Te extrañamos en GoDelivery! 👋',
      body: 'Hay nuevos comercios adheridos y promociones en Magdalena. ¡Mirá lo nuevo!',
      url: '/#/offers',
      targetAudience: 'clients'
    }
  ];

  try {
    const { collection, getDocs, doc, setDoc } = await import('firebase/firestore');
    const snap = await getDocs(collection(db, 'automated_broadcasts'));
    const existingMap = {};
    snap.docs.forEach(d => {
      existingMap[d.id] = { id: d.id, ...d.data() };
    });

    // Seed defaults if missing
    for (const def of defaultAutomations) {
      if (!existingMap[def.id]) {
        await setDoc(doc(db, 'automated_broadcasts', def.id), def, { merge: true });
        existingMap[def.id] = def;
      }
    }

    const dayLabels = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

    const html = Object.values(existingMap).map(auto => {
      const isEnabled = auto.enabled === true;
      const days = Array.isArray(auto.days) ? auto.days : [0, 1, 2, 3, 4, 5, 6];
      const timeVal = auto.time || '12:00';

      return `
        <div class="auto-card" id="card-${auto.id}" data-id="${auto.id}" style="background:var(--color-surface);border:1.5px solid ${isEnabled ? 'rgba(168,85,247,0.3)' : 'var(--color-border)'};border-radius:24px;padding:20px;box-shadow:var(--shadow-sm);display:flex;flex-direction:column;gap:16px;text-align:left;">
          
          <!-- Top Row: Icon + Title + Switch -->
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
            <div style="display:flex;align-items:center;gap:12px;min-width:0;flex:1;">
              <div style="font-size:26px;width:44px;height:44px;border-radius:14px;background:var(--color-bg-secondary);display:flex;align-items:center;justify-content:center;border:1px solid var(--color-border-light);flex-shrink:0;">
                ${auto.icon || '🔔'}
              </div>
              <div style="min-width:0;flex:1;">
                <div style="display:flex;align-items:center;gap:8px;">
                  <h4 style="font-family:var(--font-display);font-size:16px;font-weight:900;margin:0;color:var(--color-text);">${auto.name}</h4>
                  <span class="auto-status-badge" style="font-size:9.5px;font-weight:900;padding:2px 8px;border-radius:6px;text-transform:uppercase;${isEnabled ? 'background:rgba(34,197,94,0.15);color:var(--color-success);' : 'background:var(--color-bg-secondary);color:var(--color-text-tertiary);'}">
                    ${isEnabled ? 'ACTIVA' : 'PAUSADA'}
                  </span>
                </div>
                <p style="font-size:11px;color:var(--color-text-tertiary);margin:2px 0 0;font-weight:600;">${auto.description || ''}</p>
              </div>
            </div>

            <!-- iOS Style Toggle Switch -->
            <label style="position:relative;display:inline-block;width:50px;height:28px;flex-shrink:0;cursor:pointer;">
              <input type="checkbox" class="auto-toggle-input" data-id="${auto.id}" ${isEnabled ? 'checked' : ''} style="opacity:0;width:0;height:0;">
              <span style="position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background-color:${isEnabled ? '#a855f7' : '#cbd5e1'};border-radius:34px;transition:0.3s;" class="slider-track"></span>
              <span style="position:absolute;height:22px;width:22px;left:${isEnabled ? '24px' : '3px'};bottom:3px;background-color:white;border-radius:50%;transition:0.3s;box-shadow:0 2px 4px rgba(0,0,0,0.2);" class="slider-thumb"></span>
            </label>
          </div>

          <!-- Schedule Settings (Days + Time) -->
          <div style="background:var(--color-bg-secondary);border:1px solid var(--color-border);border-radius:18px;padding:14px;display:flex;flex-direction:column;gap:12px;">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
              <label style="font-weight:800;font-size:11.5px;color:var(--color-text-secondary);text-transform:uppercase;letter-spacing:0.04em;">Días de Envío:</label>
              <div class="day-pills-container" data-id="${auto.id}" style="display:flex;gap:4px;">
                ${[1, 2, 3, 4, 5, 6, 0].map(dNum => {
                  const isDaySelected = days.includes(dNum);
                  return `
                    <button type="button" class="day-pill-btn" data-day="${dNum}" style="width:34px;height:30px;border-radius:8px;font-size:11px;font-weight:900;border:1px solid ${isDaySelected ? 'var(--color-primary)' : 'var(--color-border)'};background:${isDaySelected ? 'var(--color-primary)' : 'var(--color-surface)'};color:${isDaySelected ? 'white' : 'var(--color-text-secondary)'};cursor:pointer;padding:0;transition:all 0.15s;">
                      ${dayLabels[dNum]}
                    </button>
                  `;
                }).join('')}
              </div>
            </div>

            <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;border-top:1px dashed var(--color-border-light);padding-top:10px;">
              <label style="font-weight:800;font-size:11.5px;color:var(--color-text-secondary);text-transform:uppercase;letter-spacing:0.04em;">Hora Programada:</label>
              <input type="time" class="auto-time-input" data-id="${auto.id}" value="${timeVal}" style="height:36px;border-radius:10px;padding:0 10px;font-weight:800;font-size:13px;border:1px solid var(--color-border);background:var(--color-surface);color:var(--color-text);outline:none;" />
            </div>
          </div>

          <!-- Message Customization -->
          <div style="display:flex;flex-direction:column;gap:10px;">
            <div>
              <label style="font-weight:700;font-size:10.5px;margin-bottom:4px;display:block;color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:0.04em;">Título Push</label>
              <input type="text" class="input auto-title-input" data-id="${auto.id}" value="${auto.title || ''}" placeholder="Título llamativo..." style="width:100%;height:42px;border-radius:12px;padding:0 12px;font-weight:700;font-size:13px;" />
            </div>

            <div>
              <label style="font-weight:700;font-size:10.5px;margin-bottom:4px;display:block;color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:0.04em;">Cuerpo del Mensaje</label>
              <textarea class="input auto-body-input" data-id="${auto.id}" placeholder="Mensaje..." style="width:100%;height:60px;border-radius:12px;padding:10px 12px;font-weight:500;font-size:12.5px;line-height:1.4;resize:none;">${auto.body || ''}</textarea>
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
              <div>
                <label style="font-weight:700;font-size:10.5px;margin-bottom:4px;display:block;color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:0.04em;">Destino (URL)</label>
                <input type="text" class="input auto-url-input" data-id="${auto.id}" value="${auto.url || '/#/'}" placeholder="Ej: /#/category/Comida" style="width:100%;height:40px;border-radius:12px;padding:0 10px;font-weight:700;font-size:12px;" />
              </div>

              <div>
                <label style="font-weight:700;font-size:10.5px;margin-bottom:4px;display:block;color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:0.04em;">Audiencia</label>
                <select class="input auto-audience-input" data-id="${auto.id}" style="width:100%;height:40px;border-radius:12px;padding:0 10px;font-weight:700;font-size:12px;background:var(--color-bg-secondary);border:1px solid var(--color-border);color:var(--color-text);outline:none;">
                  <option value="clients" ${auto.targetAudience === 'clients' ? 'selected' : ''}>🟢 Clientes</option>
                  <option value="all" ${auto.targetAudience === 'all' ? 'selected' : ''}>📢 Todos</option>
                  <option value="drivers" ${auto.targetAudience === 'drivers' ? 'selected' : ''}>🚴 Repartidores</option>
                </select>
              </div>
            </div>
          </div>

          <!-- Actions: Test Push & Save Changes -->
          <div style="display:flex;gap:10px;border-top:1px solid var(--color-border-light);padding-top:14px;margin-top:2px;">
            <button type="button" class="btn-test-auto-push" data-id="${auto.id}" style="flex:1;height:44px;border-radius:14px;background:var(--color-bg-secondary);border:1px solid var(--color-border);color:var(--color-text);font-weight:800;font-size:12px;display:flex;align-items:center;justify-content:center;gap:6px;cursor:pointer;">
              ${icon('send', 14)} Probar en mi móvil
            </button>
            <button type="button" class="btn-save-auto-push" data-id="${auto.id}" style="flex:1.2;height:44px;border-radius:14px;background:linear-gradient(135deg,#a855f7,#9333ea);border:none;color:white;font-weight:900;font-size:12px;display:flex;align-items:center;justify-content:center;gap:6px;cursor:pointer;box-shadow:0 4px 12px rgba(147,51,234,0.25);">
              ${icon('check', 14)} Guardar Regla
            </button>
          </div>

        </div>
      `;
    }).join('');

    container.innerHTML = html;

    // Attach Day Pill toggle handlers
    container.querySelectorAll('.day-pill-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const isSelected = btn.style.background === 'var(--color-primary)' || btn.style.background.includes('primary');
        if (isSelected) {
          btn.style.background = 'var(--color-surface)';
          btn.style.color = 'var(--color-text-secondary)';
          btn.style.borderColor = 'var(--color-border)';
        } else {
          btn.style.background = 'var(--color-primary)';
          btn.style.color = 'white';
          btn.style.borderColor = 'var(--color-primary)';
        }
      });
    });

    // Attach Switch toggle handlers
    container.querySelectorAll('.auto-toggle-input').forEach(chk => {
      chk.addEventListener('change', (e) => {
        const card = document.getElementById(`card-${chk.dataset.id}`);
        const badge = card?.querySelector('.auto-status-badge');
        const track = chk.parentElement.querySelector('.slider-track');
        const thumb = chk.parentElement.querySelector('.slider-thumb');

        if (e.target.checked) {
          if (badge) {
            badge.textContent = 'ACTIVA';
            badge.style.background = 'rgba(34,197,94,0.15)';
            badge.style.color = 'var(--color-success)';
          }
          if (track) track.style.backgroundColor = '#a855f7';
          if (thumb) thumb.style.left = '24px';
          if (card) card.style.borderColor = 'rgba(168,85,247,0.3)';
        } else {
          if (badge) {
            badge.textContent = 'PAUSADA';
            badge.style.background = 'var(--color-bg-secondary)';
            badge.style.color = 'var(--color-text-tertiary)';
          }
          if (track) track.style.backgroundColor = '#cbd5e1';
          if (thumb) thumb.style.left = '3px';
          if (card) card.style.borderColor = 'var(--color-border)';
        }
      });
    });

    // Attach Save Handlers
    container.querySelectorAll('.btn-save-auto-push').forEach(saveBtn => {
      saveBtn.addEventListener('click', async () => {
        const id = saveBtn.dataset.id;
        const card = document.getElementById(`card-${id}`);
        if (!card) return;

        const enabled = card.querySelector('.auto-toggle-input')?.checked === true;
        const selectedDays = [];
        card.querySelectorAll('.day-pill-btn').forEach(dBtn => {
          if (dBtn.style.color === 'white') {
            selectedDays.push(Number(dBtn.dataset.day));
          }
        });
        const time = card.querySelector('.auto-time-input')?.value || '12:00';
        const title = card.querySelector('.auto-title-input')?.value.trim() || 'Go Delivery';
        const body = card.querySelector('.auto-body-input')?.value.trim() || '';
        const url = card.querySelector('.auto-url-input')?.value.trim() || '/#/';
        const targetAudience = card.querySelector('.auto-audience-input')?.value || 'clients';

        if (!body) {
          showToast('El cuerpo del mensaje no puede estar vacío', 'error');
          return;
        }

        saveBtn.disabled = true;
        const originalText = saveBtn.innerHTML;
        saveBtn.innerHTML = `${icon('loader', 14, 'animate-spin')} Guardando...`;

        try {
          const { doc, updateDoc } = await import('firebase/firestore');
          await updateDoc(doc(db, 'automated_broadcasts', id), {
            enabled,
            days: selectedDays,
            time,
            title,
            body,
            url,
            targetAudience,
            updatedAt: serverTimestamp()
          });

          showToast('Configuración guardada con éxito', 'success');
        } catch (err) {
          console.error('Error saving automated push:', err);
          showToast('Error al guardar configuración', 'error');
        } finally {
          saveBtn.disabled = false;
          saveBtn.innerHTML = originalText;
        }
      });
    });

    // Attach Test Push Handlers
    container.querySelectorAll('.btn-test-auto-push').forEach(testBtn => {
      testBtn.addEventListener('click', async () => {
        const id = testBtn.dataset.id;
        const card = document.getElementById(`card-${id}`);
        if (!card) return;

        const title = card.querySelector('.auto-title-input')?.value.trim() || 'Go Delivery';
        const body = card.querySelector('.auto-body-input')?.value.trim() || '';
        const url = card.querySelector('.auto-url-input')?.value.trim() || '/#/';

        if (!body) {
          showToast('El cuerpo del mensaje no puede estar vacío', 'error');
          return;
        }

        testBtn.disabled = true;
        const originalText = testBtn.innerHTML;
        testBtn.innerHTML = `${icon('loader', 14, 'animate-spin')} Enviando prueba...`;

        try {
          const { auth } = await import('../../firebase.js');
          const token = await auth.currentUser?.getIdToken();
          if (!token) throw new Error('No autenticado');

          const res = await fetch(`https://sendglobalpush-mkje4ndb5a-uc.a.run.app`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
              title: `[PRUEBA] ${title}`,
              body,
              url,
              audience: 'clients'
            })
          });

          if (!res.ok) {
            const errData = await res.json();
            throw new Error(errData.error || 'Error al enviar prueba');
          }

          showToast('¡Notificación de prueba enviada a tu dispositivo!', 'success');
        } catch (err) {
          console.error('Error sending test push:', err);
          showToast(err.message || 'Error al enviar prueba', 'error');
        } finally {
          testBtn.disabled = false;
          testBtn.innerHTML = originalText;
        }
      });
    });

  } catch (err) {
    console.error('Error loading automations:', err);
    container.innerHTML = `
      <div style="text-align:center;padding:24px;color:var(--color-danger);font-size:13px;font-weight:800;background:var(--color-surface);border:1px solid var(--color-border);border-radius:24px;">
        Error al cargar automatizaciones. Verificá tu conexión.
      </div>
    `;
  }
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
      <div style="background:var(--color-primary); padding:calc(16px + env(safe-area-inset-top, 0px)) 20px 16px; display:flex; align-items:center; justify-content:space-between; gap:16px; flex-shrink:0; position:relative; overflow:hidden; box-shadow:0 4px 12px rgba(var(--color-primary-rgb),0.2); z-index:100;">
        <!-- Decorative Circles -->
        <div style="position: absolute; top: -20px; right: -20px; width: 80px; height: 80px; background: rgba(255,255,255,0.08); border-radius: 50%; pointer-events: none;"></div>
        
        <div style="display:flex;align-items:center;gap:14px;min-width:0;flex:1;position:relative;z-index:2;">
          <a href="#/admin" style="display:flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:12px;background:rgba(255,255,255,0.15);color:white;flex-shrink:0;text-decoration:none;transition:all 0.2s;">${icon('chevronLeft', 24)}</a>
          <div style="min-width:0;flex:1;">
            <h1 style="font-family:var(--font-display);font-weight:900;font-size:20px;color:white;margin:0;line-height:1.2;letter-spacing:-0.02em;">Historial de Campañas</h1>
            <p style="font-size:11px;color:rgba(255,255,255,0.7);font-weight:800;margin:2px 0 0;text-transform:uppercase;letter-spacing:0.05em;">Métricas y Programaciones</p>
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
        <div style="display:flex;flex-direction:column;gap:18px;padding-bottom:40px;max-width:600px;margin:0 auto;">

          <!-- Navigation Sub-Tabs -->
          <div style="display:flex;align-items:center;background:var(--color-bg-secondary);border:1px solid var(--color-border);border-radius:16px;padding:4px;gap:4px;">
            <a href="#/admin/broadcasts" style="flex:1;text-align:center;padding:10px 4px;font-size:12px;font-weight:850;border-radius:12px;text-decoration:none;display:flex;align-items:center;justify-content:center;gap:6px;color:var(--color-text-secondary);background:transparent;">
              <span>📢</span> Manual / Prog.
            </a>
            <a href="#/admin/broadcasts/automations" style="flex:1;text-align:center;padding:10px 4px;font-size:12px;font-weight:850;border-radius:12px;text-decoration:none;display:flex;align-items:center;justify-content:center;gap:6px;color:var(--color-text-secondary);background:transparent;">
              <span>🤖</span> Automáticas
            </a>
            <a href="#/admin/broadcasts/history" style="flex:1;text-align:center;padding:10px 4px;font-size:12px;font-weight:850;border-radius:12px;text-decoration:none;display:flex;align-items:center;justify-content:center;gap:6px;background:var(--color-primary);color:white;box-shadow:0 4px 12px rgba(225,29,72,0.25);">
              <span>📊</span> Historial
            </a>
          </div>

          <div id="push-campaigns-history-container" style="display:flex;flex-direction:column;gap:16px;">
            <!-- Renders dynamically -->
          </div>
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
      message: '¿Estás seguro de que deseas eliminar permanentemente todo el historial de campañas? Esta acción no se puede deshacer.',
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
    const { collection, getDocs, query, orderBy, deleteDoc, doc: fDoc } = await import('firebase/firestore');
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
      const bId = docSnap.id;
      const clicks = b.clicks || 0;
      const sentCount = b.sentCount || 0;
      const ctr = sentCount > 0 ? ((clicks / sentCount) * 100).toFixed(1) : '0.0';
      const isScheduled = b.status === 'scheduled';
      const isAutomated = b.isAutomated === true;

      const createdDateStr = b.createdAt?.toDate ? b.createdAt.toDate().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'Reciente';
      const schedDateStr = b.scheduledAt?.toDate ? b.scheduledAt.toDate().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';

      const audienceNames = {
        all: '📢 Todos',
        clients: '🟢 Clientes',
        drivers: '🚴 Repartidores',
        stores: '🏪 Comercios'
      };

      const progressColor = ctr > 15 ? 'var(--color-success)' : ctr > 5 ? 'var(--color-primary)' : 'var(--color-text-tertiary)';

      return `
        <div style="background:var(--color-surface);border:1.5px solid ${isScheduled ? '#a855f7' : (isAutomated ? 'rgba(168,85,247,0.3)' : 'var(--color-border)')};border-radius:24px;padding:20px;display:flex;flex-direction:column;gap:12px;text-align:left;box-shadow:var(--shadow-sm);position:relative;">
          
          ${isScheduled ? `
            <div style="display:flex;align-items:center;justify-content:space-between;background:rgba(168,85,247,0.1);padding:6px 12px;border-radius:10px;border:1px solid rgba(168,85,247,0.25);">
              <span style="font-size:11px;font-weight:900;color:#9333ea;display:flex;align-items:center;gap:6px;">
                ${icon('clock', 13)} Programada para: ${schedDateStr}
              </span>
              <button type="button" class="btn-cancel-scheduled-broadcast" data-id="${bId}" style="background:none;border:none;color:var(--color-danger);font-size:11px;font-weight:850;cursor:pointer;padding:0;text-decoration:underline;">
                Cancelar
              </button>
            </div>
          ` : ''}

          ${isAutomated ? `
            <div style="display:flex;align-items:center;gap:6px;background:rgba(168,85,247,0.08);padding:4px 10px;border-radius:8px;width:fit-content;border:1px solid rgba(168,85,247,0.2);">
              <span style="font-size:10.5px;font-weight:900;color:#9333ea;">🤖 Automatización: ${b.automationName || 'Gatillo Horario'}</span>
            </div>
          ` : ''}

          <div style="display:flex;justify-content:space-between;align-items:start;gap:12px;">
            <div style="min-width:0;flex:1;">
              <h5 style="font-family:var(--font-display);font-size:15px;font-weight:900;color:var(--color-text);margin:0;letter-spacing:-0.01em;">${b.title || 'Go Delivery'}</h5>
              <p style="font-size:12.5px;color:var(--color-text-secondary);margin:6px 0 0;line-height:1.45;word-break:break-word;">${b.body}</p>
              ${b.url ? `<span style="display:inline-block;font-size:11px;color:var(--color-primary);font-weight:700;margin-top:6px;font-family:monospace;background:var(--color-primary-light);padding:2px 8px;border-radius:6px;">🔗 ${b.url}</span>` : ''}
            </div>
            <span style="font-size:10px;background:var(--color-bg-secondary);border:1px solid var(--color-border);color:var(--color-text-secondary);padding:4px 10px;border-radius:8px;font-weight:800;white-space:nowrap;text-transform:uppercase;letter-spacing:0.04em;">${audienceNames[b.targetAudience] || 'Público'}</span>
          </div>

          ${b.imageUrl ? `
            <div style="border-radius:14px;overflow:hidden;border:1px solid var(--color-border-light);height:120px;width:100%;margin-top:4px;">
              <img src="${b.imageUrl}" style="width:100%;height:100%;object-fit:cover;" />
            </div>
          ` : ''}

          ${!isScheduled ? `
            <div style="border-top:1px dashed var(--color-border-light);padding-top:12px;display:flex;align-items:center;justify-content:space-between;font-size:11px;font-weight:800;color:var(--color-text-tertiary);">
              <span>📅 ${createdDateStr}</span>
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
          ` : ''}
        </div>
      `;
    }).join('');

    container.innerHTML = `<div style="display:flex;flex-direction:column;gap:16px;">${listHtml}</div>`;

    // Attach cancel listeners for scheduled broadcasts
    container.querySelectorAll('.btn-cancel-scheduled-broadcast').forEach(btn => {
      btn.addEventListener('click', async () => {
        const docId = btn.dataset.id;
        if (!docId) return;
        showConfirm({
          title: '❌ CANCELAR PROGRAMACIÓN',
          message: '¿Estás seguro de que deseas cancelar y eliminar esta campaña programada? Ya no se enviará a los usuarios.',
          confirmText: 'SÍ, CANCELAR CAMPAÑA',
          cancelText: 'VOLVER',
          danger: true,
          onConfirm: async () => {
            try {
              await deleteDoc(fDoc(db, 'broadcasts', docId));
              showToast('Campaña programada cancelada', 'success');
              await loadAndRenderBroadcastsHistory();
            } catch (err) {
              console.error('Error cancelling scheduled broadcast:', err);
              showToast('Error al cancelar campaña', 'error');
            }
          }
        });
      });
    });

  } catch (err) {
    console.error('Error fetching broadcasts history:', err);
    container.innerHTML = `
      <div style="text-align:center;padding:24px;color:var(--color-danger);font-size:13px;font-weight:800;background:var(--color-surface);border:1px solid var(--color-border);border-radius:24px;">
        Error al cargar el historial. Verificá tu conexión.
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
