import { db } from '../firebase.js';
import { doc, getDoc, collection, addDoc, query, where, getDocs } from 'firebase/firestore';
import { getState } from '../state.js';
import { icon } from '../utils/icons.js';

export async function renderProductDetail(productId, content) {
  if (!content) content = document.getElementById('app-content');
  if (!content) return;

  content.innerHTML = `
    <div class="marketplace-detail-container" style="display:flex; flex-direction:column; height:100%; background:var(--color-bg); position:relative;">
      <div style="padding:40px; text-align:center; color:var(--color-text-secondary);">
        Cargando detalles del producto...
      </div>
    </div>
  `;

  try {
    const snap = await getDoc(doc(db, 'marketplace_products', productId));
    if (!snap.exists()) {
      content.innerHTML = `
        <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; padding:20px; text-align:center;">
          <h3 style="margin-bottom:8px;">Publicación no encontrada</h3>
          <a href="#/marketplace" style="background:var(--color-primary); color:white; padding:10px 20px; border-radius:10px; text-decoration:none; font-weight:700;">Volver al Marketplace</a>
        </div>
      `;
      return;
    }

    const product = snap.data();
    const currentUser = getState().user;
    const isOwner = currentUser && currentUser.uid === product.sellerId;

    content.innerHTML = `
      <div class="marketplace-detail-container" style="display:flex; flex-direction:column; height:100%; background:var(--color-bg); position:relative; box-sizing:border-box;">
        <!-- Header (Red Premium style) -->
        <div style="background:var(--color-primary); padding:calc(16px + env(safe-area-inset-top, 0px)) 20px 16px; display:flex; align-items:center; gap:16px; flex-shrink:0; position:relative; overflow:hidden; box-shadow:0 4px 12px rgba(var(--color-primary-rgb),0.2); z-index:100;">
          <a href="#/marketplace" style="width:40px; height:40px; border-radius:12px; background:rgba(255,255,255,0.15); border:none; display:flex; align-items:center; justify-content:center; color:white; text-decoration:none; transition:all 0.2s;">
            ${icon('chevronLeft', 24)}
          </a>
          <div style="flex:1;">
            <h1 style="font-family:var(--font-display); font-size:20px; font-weight:900; color:white; margin:0; letter-spacing:-0.03em;">Detalle del Producto</h1>
            <p style="font-size:11px; font-weight:800; color:rgba(255,255,255,0.7); text-transform:uppercase; letter-spacing:0.1em; margin:2px 0 0;">Marketplace</p>
          </div>
        </div>

        <!-- Scrollable Content -->
        <div style="flex:1; overflow-y:auto; display:flex; flex-direction:column; box-sizing:border-box;">
          <!-- Image Banner -->
          <div style="position:relative; width:100%; padding-top:75%; background:#e5e5e5; display:flex; align-items:center; justify-content:center;">
            <img src="${product.images?.[0] || '/logo.png'}" style="position:absolute; top:0; left:0; width:100%; height:100%; object-fit:cover;" />
          </div>

          <!-- Product Details -->
          <div style="padding:20px; display:flex; flex-direction:column; gap:12px; background:var(--color-surface); border-bottom:1px solid var(--color-border);">
            <div style="display:flex; align-items:center; justify-content:space-between;">
              <span style="font-size:24px; font-weight:900; color:var(--color-primary);">$${product.price}</span>
              <span style="background:${product.condition === 'new' ? '#10B981' : '#F59E0B'}; color:white; font-size:11px; font-weight:800; padding:4px 10px; border-radius:8px; text-transform:uppercase;">
                ${product.condition === 'new' ? 'Nuevo' : 'Usado'}
              </span>
            </div>
            
            <h2 style="font-family:var(--font-display); font-size:18px; font-weight:800; margin:0; color:var(--color-text);">${product.title}</h2>
            <div style="font-size:12px; color:var(--color-text-secondary);">Publicado por: <span style="font-weight:700; color:var(--color-text);">${product.sellerName}</span></div>
          </div>

          <!-- Description -->
          <div style="padding:20px; background:var(--color-surface); flex:1;">
            <h3 style="font-size:14px; font-weight:800; text-transform:uppercase; color:var(--color-text-secondary); margin:0 0 10px 0;">Descripción</h3>
            <p style="font-size:14px; line-height:1.6; color:var(--color-text); margin:0; white-space:pre-wrap;">${product.description}</p>
          </div>
        </div>

        <!-- Floating Actions Footer -->
        <div style="padding:16px; border-top:1px solid var(--color-border); background:var(--color-surface); display:flex; justify-content:center;">
          ${isOwner ? `
            <button disabled style="width:100%; height:50px; background:var(--color-border); color:var(--color-text-secondary); border:none; border-radius:14px; font-weight:800; font-size:15px; cursor:not-allowed;">Tu publicación</button>
          ` : `
            <button id="btn-contact-seller" style="width:100%; height:50px; background:var(--color-primary); color:white; border:none; border-radius:14px; font-weight:800; font-size:15px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px; box-shadow:0 8px 24px rgba(var(--color-primary-rgb),0.2);">
              ${icon('chat', 18) || '💬'} Contactar Vendedor
            </button>
          `}
        </div>
      </div>
    `;

    if (!isOwner) {
      const contactBtn = content.querySelector('#btn-contact-seller');
      contactBtn.onclick = () => {
        if (!currentUser) {
          window.location.hash = '#/profile';
          return;
        }

        import('../components/modal.js').then(m => {
          m.showConfirm({
            title: '¿Contactar vendedor?',
            message: '¿Estás seguro? Al confirmar, se le enviará una notificación al vendedor de que estás interesado en su producto y se abrirá un chat directo.',
            confirmText: 'Confirmar',
            cancelText: 'Cancelar',
            onConfirm: async () => {
              contactBtn.disabled = true;
              contactBtn.innerText = 'Iniciando chat...';

              try {
                // Check if chat already exists
                const q = query(
                  collection(db, 'marketplace_chats'),
                  where('productId', '==', productId),
                  where('buyerId', '==', currentUser.uid)
                );
                const chatSnap = await getDocs(q);

                if (!chatSnap.empty) {
                  window.location.hash = `#/marketplace/chat/${chatSnap.docs[0].id}`;
                  return;
                }

                // Create new chat
                const newChatRef = await addDoc(collection(db, 'marketplace_chats'), {
                  productId,
                  productTitle: product.title,
                  productImage: product.images?.[0] || '',
                  buyerId: currentUser.uid,
                  buyerName: currentUser.displayName || 'Comprador',
                  sellerId: product.sellerId,
                  sellerName: product.sellerName,
                  lastMessage: 'Hola, estoy interesado en tu producto.',
                  lastMessageAt: new Date(),
                  unreadBy: [product.sellerId]
                });

                // Add initial welcome auto-message
                await addDoc(collection(db, 'marketplace_chats', newChatRef.id, 'messages'), {
                  senderId: currentUser.uid,
                  senderName: currentUser.displayName || 'Comprador',
                  text: 'Hola, estoy interesado en tu producto.',
                  createdAt: new Date()
                });

                // Send notification to seller
                await addDoc(collection(db, 'notifications'), {
                  userId: product.sellerId,
                  title: '¡Interés en tu producto!',
                  body: `${currentUser.displayName || 'Un comprador'} está interesado en tu producto "${product.title}".`,
                  type: 'marketplace_interest',
                  chatId: newChatRef.id,
                  createdAt: new Date(),
                  read: false
                });

                window.location.hash = `#/marketplace/chat/${newChatRef.id}`;
              } catch (err) {
                console.error('Error creating chat:', err);
                alert('Hubo un problema al crear el chat. Intentalo nuevamente.');
                contactBtn.disabled = false;
                contactBtn.innerText = 'Contactar Vendedor';
              }
            }
          });
        });
      };
    }

  } catch (err) {
    console.error('Error rendering product detail:', err);
    content.innerHTML = `
      <div style="padding:40px; text-align:center; color:var(--color-primary);">
        Error al cargar los detalles del producto.
      </div>
    `;
  }

  return {
    cleanup: () => {}
  };
}
