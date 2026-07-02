import { db } from '../firebase.js';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { getState } from '../state.js';
import { icon } from '../utils/icons.js';

export async function renderPublishProduct(content) {
  if (!content) content = document.getElementById('app-content');
  if (!content) return;

  const user = getState().user;
  if (!user) {
    window.location.hash = '#/profile';
    return;
  }

  content.innerHTML = `
    <div class="marketplace-publish-container" style="display:flex; flex-direction:column; height:100%; background:var(--color-bg); position:relative; box-sizing:border-box;">
      <!-- Header (Red Premium style) -->
      <div style="background:var(--color-primary); padding:calc(16px + env(safe-area-inset-top, 0px)) 20px 16px; display:flex; align-items:center; gap:16px; flex-shrink:0; position:relative; overflow:hidden; box-shadow:0 4px 12px rgba(var(--color-primary-rgb),0.2); z-index:100;">
        <a href="#/marketplace" style="width:40px; height:40px; border-radius:12px; background:rgba(255,255,255,0.15); border:none; display:flex; align-items:center; justify-content:center; color:white; text-decoration:none; transition:all 0.2s;">
          ${icon('chevronLeft', 24)}
        </a>
        <div style="flex:1;">
          <h1 style="font-family:var(--font-display); font-size:20px; font-weight:900; color:white; margin:0; letter-spacing:-0.03em;">Vender un producto</h1>
          <p style="font-size:11px; font-weight:800; color:rgba(255,255,255,0.7); text-transform:uppercase; letter-spacing:0.1em; margin:2px 0 0;">Marketplace</p>
        </div>
      </div>

      <!-- Form -->
      <form id="publish-form" style="flex:1; overflow-y:auto; padding:20px; display:flex; flex-direction:column; gap:16px; box-sizing:border-box;">
        <div style="display:flex; flex-direction:column; gap:6px;">
          <label style="font-size:12px; font-weight:800; text-transform:uppercase; color:var(--color-text-secondary);">Título del Anuncio</label>
          <input type="text" id="prod-title" required placeholder="Ej. Bicicleta rodado 29 seminueva" style="height:48px; border-radius:12px; border:1px solid var(--color-border); padding:0 16px; font-size:14px; background:var(--color-surface); color:var(--color-text); box-sizing:border-box;" />
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
          <div style="display:flex; flex-direction:column; gap:6px;">
            <label style="font-size:12px; font-weight:800; text-transform:uppercase; color:var(--color-text-secondary);">Precio ($)</label>
            <input type="number" id="prod-price" required placeholder="Ej. 12000" style="height:48px; border-radius:12px; border:1px solid var(--color-border); padding:0 16px; font-size:14px; background:var(--color-surface); color:var(--color-text); box-sizing:border-box;" />
          </div>
          <div style="display:flex; flex-direction:column; gap:6px;">
            <label style="font-size:12px; font-weight:800; text-transform:uppercase; color:var(--color-text-secondary);">Condición</label>
            <select id="prod-condition" style="height:48px; border-radius:12px; border:1px solid var(--color-border); padding:0 16px; font-size:14px; background:var(--color-surface); color:var(--color-text); box-sizing:border-box; cursor:pointer;">
              <option value="used">Usado</option>
              <option value="new">Nuevo</option>
            </select>
          </div>
        </div>

        <div style="display:flex; flex-direction:column; gap:6px;">
          <label style="font-size:12px; font-weight:800; text-transform:uppercase; color:var(--color-text-secondary);">Descripción</label>
          <textarea id="prod-desc" required placeholder="Detallá el estado del producto, accesorios que incluye, etc." style="height:120px; border-radius:12px; border:1px solid var(--color-border); padding:12px 16px; font-size:14px; background:var(--color-surface); color:var(--color-text); font-family:inherit; resize:none; box-sizing:border-box;"></textarea>
        </div>

        <div style="display:flex; flex-direction:column; gap:6px;">
          <label style="font-size:12px; font-weight:800; text-transform:uppercase; color:var(--color-text-secondary);">URL de Imagen (Simulada)</label>
          <input type="url" id="prod-image" placeholder="Pegá el link de una imagen (ej: https://picsum.photos/400)" style="height:48px; border-radius:12px; border:1px solid var(--color-border); padding:0 16px; font-size:14px; background:var(--color-surface); color:var(--color-text); box-sizing:border-box;" />
          <span style="font-size:11px; color:var(--color-text-secondary);">Por ahora podés usar cualquier link de imagen público para pruebas.</span>
        </div>

        <button type="submit" id="btn-submit-publish" style="height:50px; background:var(--color-primary); color:white; border:none; border-radius:14px; font-weight:800; font-size:16px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px; margin-top:12px; box-shadow:0 8px 24px rgba(var(--color-primary-rgb),0.2);">
          Publicar Producto
        </button>
      </form>
    </div>
  `;

  const form = content.querySelector('#publish-form');
  const submitBtn = content.querySelector('#btn-submit-publish');

  form.onsubmit = async (e) => {
    e.preventDefault();

    if (submitBtn.disabled) return;
    submitBtn.disabled = true;
    submitBtn.innerText = 'Publicando...';

    const title = content.querySelector('#prod-title').value.trim();
    const price = parseFloat(content.querySelector('#prod-price').value);
    const condition = content.querySelector('#prod-condition').value;
    const description = content.querySelector('#prod-desc').value.trim();
    const imageUrl = content.querySelector('#prod-image').value.trim() || 'https://picsum.photos/400';

    // Simple anti-bypass sanitization (No phones or emails in description)
    const phoneOrEmailRegex = /(\b[0-9]{3,4}[- ]?[0-9]{3,4}[- ]?[0-9]{3,4}\b)|(\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b)/g;
    if (phoneOrEmailRegex.test(description) || phoneOrEmailRegex.test(title)) {
      alert('Por seguridad, no está permitido incluir números de teléfono o correos electrónicos en la descripción o título del producto. Toda la comunicación es mediante el chat interno.');
      submitBtn.disabled = false;
      submitBtn.innerText = 'Publicar Producto';
      return;
    }

    try {
      await addDoc(collection(db, 'marketplace_products'), {
        title,
        price,
        condition,
        description,
        images: [imageUrl],
        sellerId: user.uid,
        sellerName: user.displayName || 'Usuario de GoDelivery',
        status: 'pending', // Requerirá aprobación de administrador
        createdAt: serverTimestamp()
      });

      alert('¡Producto enviado! Será visible en el Marketplace una vez aprobado por el administrador.');
      window.location.hash = '#/marketplace';
    } catch (err) {
      console.error('Error publishing product:', err);
      alert('Hubo un error al publicar el producto. Reintentá nuevamente.');
      submitBtn.disabled = false;
      submitBtn.innerText = 'Publicar Producto';
    }
  };

  return {
    cleanup: () => {}
  };
}
