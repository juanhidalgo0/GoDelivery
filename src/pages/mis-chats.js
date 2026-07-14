// GoDelivery — Mis Chats Page
import { getState, subscribe } from '../state.js';
import { db } from '../firebase.js';
import { collection, doc, query, where, getDoc, onSnapshot, or } from 'firebase/firestore';
import { icon } from '../utils/icons.js';
import { isAdmin, isComercio } from '../auth.js';

let unsubSupport = null;
let unsubChats = null;
let unsubMarketplace = null;
let currentSupportChat = null;
let currentOrderChats = [];
let currentMarketplaceChats = [];

export async function renderMisChats(content) {
  if (!content) content = document.getElementById('app-content');
  if (!content) return;

  const isNative = !!window.Capacitor;
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isIosDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const topPadding = isNative ? 'var(--status-bar-height, 24px)' : ((isIosDevice && isStandalone) ? 'calc(34px + env(safe-area-inset-top, 0px))' : 'env(safe-area-inset-top, 0px)');

  const user = getState().user;
  if (!user) {
    content.innerHTML = `
      <div class="chats-panel-page page-enter" style="display: flex; flex-direction: column; height: 100%; width: 100%; background: var(--color-bg); overflow: hidden; position: relative;">
        <!-- Header -->
        <div style="background: var(--color-primary); padding: ${topPadding} 0 0 0; position: relative; overflow: hidden; border-bottom-left-radius: 28px; border-bottom-right-radius: 28px; box-shadow: 0 8px 32px rgba(225, 29, 72, 0.2); z-index: 100; flex-shrink: 0;">
          <!-- Decorative Circles -->
          <div style="position: absolute; inset: 0; overflow: hidden; border-bottom-left-radius: 28px; border-bottom-right-radius: 28px; pointer-events: none; z-index: 1;">
            <div style="position: absolute; top: -30px; right: -30px; width: 120px; height: 120px; background: rgba(255,255,255,0.08); border-radius: 50%;"></div>
            <div style="position: absolute; bottom: -10px; left: 100px; width: 50px; height: 50px; background: rgba(255,255,255,0.04); border-radius: 50%;"></div>
          </div>

          <div style="height: 56px; padding: 0 20px; display: flex; align-items: center; gap: 16px; position: relative; z-index: 2;">
            <span style="font-weight: 800; font-size: 20px; color: white; font-family: var(--font-display); letter-spacing: -0.02em;">Mis Chats</span>
          </div>
        </div>
        <div style="text-align: center; padding: 60px 20px; color: var(--color-text-tertiary); flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;">
          <div style="font-size: 44px; margin-bottom: 16px;">🔒</div>
          <h3 style="margin: 0 0 8px 0; font-size: 18px; font-weight: 800; color: var(--color-text-secondary);">Iniciá sesión</h3>
          <p style="margin: 0; font-size: 13px; font-weight: 500;">Iniciá sesión para poder ver tu historial de chats.</p>
        </div>
      </div>
    `;
    return;
  }

  content.innerHTML = `
    <div class="chats-panel-page page-enter" style="display: flex; flex-direction: column; height: 100%; width: 100%; background: var(--color-bg); overflow: hidden; position: relative;">
      <!-- Header -->
      <div style="background: var(--color-primary); padding: ${topPadding} 0 0 0; position: relative; overflow: hidden; border-bottom-left-radius: 28px; border-bottom-right-radius: 28px; box-shadow: 0 8px 32px rgba(225, 29, 72, 0.2); z-index: 100; flex-shrink: 0;">
        <!-- Decorative Circles -->
        <div style="position: absolute; inset: 0; overflow: hidden; border-bottom-left-radius: 28px; border-bottom-right-radius: 28px; pointer-events: none; z-index: 1;">
          <div style="position: absolute; top: -30px; right: -30px; width: 120px; height: 120px; background: rgba(255,255,255,0.08); border-radius: 50%;"></div>
          <div style="position: absolute; bottom: -10px; left: 100px; width: 50px; height: 50px; background: rgba(255,255,255,0.04); border-radius: 50%;"></div>
        </div>

        <div style="height: 56px; padding: 0 20px; display: flex; align-items: center; gap: 16px; position: relative; z-index: 2;">
          <span style="font-weight: 800; font-size: 20px; color: white; font-family: var(--font-display); letter-spacing: -0.02em;">Mis Chats</span>
          
          ${isAdmin() || isComercio() ? `
            <a href="#/admin/support-chats" style="margin-left: auto; font-size: 11px; padding: 8px 14px; text-decoration: none; display: flex; align-items: center; gap: 6px; border-radius: 12px; background: rgba(255,255,255,0.2); color: white; font-weight: 900; transition: all 0.2s; border: none; cursor: pointer;" onmouseover="this.style.background='rgba(255,255,255,0.35)'" onmouseout="this.style.background='rgba(255,255,255,0.2)'">
              ${icon('shield', 12)} Panel Soporte
            </a>
          ` : ''}
        </div>
      </div>

      <!-- Scrollable list of chats -->
      <div id="chats-list-container" style="flex: 1; overflow-y: auto; padding: 20px 20px calc(40px + env(safe-area-inset-bottom, 0px)) 20px; display: flex; flex-direction: column; gap: 12px; background: var(--color-bg); -webkit-overflow-scrolling:touch;">
        <div class="initial-loader" style="text-align: center; padding: 40px;">
          <div class="spinner-mini"></div>
        </div>
      </div>
    </div>
  `;

  const container = document.getElementById('chats-list-container');
  startChatsListener(container, user);

  const unsubUser = subscribe('user', (newUser) => {
    if (!newUser) {
      cleanup();
      location.hash = '#/profile';
    }
  });

  return {
    cleanup: () => {
      cleanup();
      unsubUser();
    }
  };
}

function cleanup() {
  if (unsubSupport) { unsubSupport(); unsubSupport = null; }
  if (unsubChats) { unsubChats(); unsubChats = null; }
  if (unsubMarketplace) { unsubMarketplace(); unsubMarketplace = null; }
  currentSupportChat = null;
  currentOrderChats = [];
  currentMarketplaceChats = [];
}

function startChatsListener(container, user) {
  cleanup();

  // 1. Listen to support chat
  const supportRef = doc(db, 'support_chats', user.uid);
  unsubSupport = onSnapshot(supportRef, (docSnap) => {
    currentSupportChat = docSnap.exists() ? { id: docSnap.id, isSupport: true, ...docSnap.data() } : null;
    renderChats(container, user);
  }, (err) => console.warn('[MisChats] Support listener error:', err));

  // 2. Listen to order chats
  const chatsQuery = query(collection(db, 'chats'), where('participants', 'array-contains', user.uid));
  unsubChats = onSnapshot(chatsQuery, async (snap) => {
    const orderChats = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Fetch order details in parallel
    const orderPromises = orderChats.map(async (chat) => {
      try {
        const orderSnap = await getDoc(doc(db, 'orders', chat.orderId));
        if (orderSnap.exists()) {
          chat.order = orderSnap.data();
        }
      } catch (e) {
        console.error('[MisChats] Error fetching order:', chat.orderId, e);
      }
    });
    await Promise.all(orderPromises);

    currentOrderChats = orderChats;
    renderChats(container, user);
  }, (err) => console.warn('[MisChats] Order chats listener error:', err));

  // 3. Listen to marketplace chats
  const marketplaceQuery = query(
    collection(db, 'marketplace_chats'),
    or(where('buyerId', '==', user.uid), where('sellerId', '==', user.uid))
  );
  unsubMarketplace = onSnapshot(marketplaceQuery, (snap) => {
    currentMarketplaceChats = snap.docs.map(d => ({ id: d.id, isMarketplace: true, ...d.data() }));
    renderChats(container, user);
  }, (err) => console.warn('[MisChats] Marketplace chats listener error:', err));
}

function formatTime(timestamp) {
  if (!timestamp) return '';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function renderChats(container, user) {
  if (!container) return;

  let html = '';
  
  // Create unified sorted list of active chats (orders + marketplace)
  const combinedChats = [];
  
  // 1. Gather Order Chats
  currentOrderChats.filter(c => c.order).forEach(chat => {
    combinedChats.push({
      ...chat,
      isMarketplace: false,
      sortTime: chat.lastMessageAt?.toDate?.() || chat.lastActivityAt?.toDate?.() || 0
    });
  });
  
  // 2. Gather Marketplace Chats
  currentMarketplaceChats.forEach(chat => {
    combinedChats.push({
      ...chat,
      isMarketplace: true,
      sortTime: chat.lastMessageAt?.toDate?.() || chat.lastActivityAt?.toDate?.() || 0
    });
  });
  
  // 3. Sort chronologically (newest first)
  combinedChats.sort((a, b) => b.sortTime - a.sortTime);

  // 1. Render Support Chat if it exists (pinned at the top)
  if (currentSupportChat) {
    const isUnread = currentSupportChat.unreadByUser === true;
    const lastMsg = currentSupportChat.lastMessageText || 'Chat de soporte iniciado';
    const time = currentSupportChat.lastMessageTime ? formatTime(currentSupportChat.lastMessageTime) : '';

    html += `
      <div class="chat-list-card support-chat-card" id="open-support-chat-item" style="display: flex; align-items: center; gap: 12px; padding: 14px; background: var(--color-surface); border: 1.5px solid ${isUnread ? 'var(--color-primary)' : 'var(--color-border-light)'}; border-radius: 20px; cursor: pointer; position: relative; transition: all 0.2s; box-shadow: var(--shadow-sm);">
        <div style="width: 44px; height: 44px; border-radius: 12px; background: linear-gradient(135deg, var(--color-primary), #E31B23); color: white; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 12px rgba(225, 29, 72, 0.2);">
          ${icon('chatBubble', 22)}
        </div>
        <div style="flex: 1; min-width: 0; text-align: left;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
            <div style="display:flex; align-items:center; gap:4px;">
              <span style="font-family: var(--font-display); font-size: 14.5px; font-weight: 850; color: var(--color-text-primary);">Soporte GoDelivery</span>
              ${currentSupportChat.status === 'pending' ? `<span style="background: rgba(245,158,11,0.12); color: #d97706; border: 1px solid rgba(245,158,11,0.2); padding: 2px 6px; border-radius: 6px; font-size: 9px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.3px; display:inline-block; vertical-align:middle; line-height:1;">Pendiente</span>` : ''}
            </div>
            <span style="font-size: 11px; color: var(--color-text-tertiary); font-weight: 700;">${time}</span>
          </div>
          <p style="margin: 0; font-size: 12px; color: var(--color-text-secondary); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${lastMsg}</p>
        </div>
        ${isUnread ? `
          <span style="width: 10px; height: 10px; border-radius: 50%; background: var(--color-primary); position: absolute; right: 14px; bottom: 14px;"></span>
        ` : ''}
      </div>
    `;
  }

  // 2. Render Unified Chats list
  if (combinedChats.length > 0) {
    combinedChats.forEach(chat => {
      const time = chat.lastMessageAt ? formatTime(chat.lastMessageAt) : '';

      if (chat.isMarketplace) {
        // Marketplace Chat UI card
        const otherName = user.uid === chat.buyerId ? chat.sellerName : chat.buyerName;
        const isUnread = chat.unreadBy && chat.unreadBy.includes(user.uid);
        const lastMsg = chat.lastMessage || 'Conversación iniciada';

        html += `
          <div class="chat-list-card marketplace-chat-card" data-chat-id="${chat.id}" style="display: flex; align-items: center; gap: 12px; padding: 14px; background: var(--color-surface); border: 1.5px solid ${isUnread ? 'var(--color-primary)' : 'var(--color-border-light)'}; border-radius: 20px; cursor: pointer; position: relative; transition: all 0.2s; box-shadow: var(--shadow-sm);">
            <div style="width: 44px; height: 44px; border-radius: 12px; background: var(--color-bg-secondary); color: var(--color-text-secondary); display: flex; align-items: center; justify-content: center; flex-shrink: 0; border: 1px solid var(--color-border-light);">
              ${icon('shoppingBag', 22)}
            </div>
            <div style="flex: 1; min-width: 0; text-align: left;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
                <span style="font-family: var(--font-display); font-size: 14.5px; font-weight: 850; color: var(--color-text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 70%;">${otherName}</span>
                <span style="font-size: 11px; color: var(--color-text-tertiary); font-weight: 700;">${time}</span>
              </div>
              <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                <span style="font-size: 10px; font-weight: 800; background: rgba(225,29,72,0.1); color: var(--color-primary); padding: 1px 6px; border-radius: 4px; flex-shrink: 0;">Marketplace</span>
                <span style="font-size: 10.5px; font-weight: 750; color: var(--color-text-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${chat.productTitle}</span>
              </div>
              <p style="margin: 0; font-size: 12px; color: var(--color-text-secondary); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${lastMsg}</p>
            </div>
            ${isUnread ? `
              <span style="width: 10px; height: 10px; border-radius: 50%; background: var(--color-primary); position: absolute; right: 14px; bottom: 14px;"></span>
            ` : ''}
          </div>
        `;
      } else {
        // Order Chat UI card (existing logic)
        const order = chat.order;
        let otherName = 'Usuario';
        let avatarIcon = 'user';

        if (user.uid === order.userId) {
          if (chat.type === 'client-commerce') {
            otherName = order.comercioName || 'Comercio';
            avatarIcon = 'store';
          } else if (chat.type === 'client-delivery') {
            otherName = order.driverName || 'Repartidor';
            avatarIcon = 'bike';
          }
        } else if (order.comercioId && user.uid === order.comercioId || (order.comercioOwnerId && user.uid === order.comercioOwnerId)) {
          if (chat.type === 'client-commerce') {
            otherName = order.userName || 'Cliente';
            avatarIcon = 'user';
          } else if (chat.type === 'commerce-delivery') {
            otherName = order.driverName || 'Repartidor';
            avatarIcon = 'bike';
          }
        } else if (user.uid === order.driverId) {
          if (chat.type === 'client-delivery') {
            otherName = order.userName || 'Cliente';
            avatarIcon = 'user';
          } else if (chat.type === 'commerce-delivery') {
            otherName = order.comercioName || 'Comercio';
            avatarIcon = 'store';
          }
        }

        const isUnread = chat.unread && chat.unread[user.uid] === true;
        const lastMsg = chat.lastMessage || 'Conversación iniciada';
        const isCompleted = order.status === 'completed' || order.status === 'cancelled';

        html += `
          <div class="chat-list-card order-chat-card" data-chat-id="${chat.id}" style="display: flex; align-items: center; gap: 12px; padding: 14px; background: var(--color-surface); border: 1.5px solid ${isUnread ? 'var(--color-primary)' : 'var(--color-border-light)'}; border-radius: 20px; cursor: pointer; position: relative; transition: all 0.2s; box-shadow: var(--shadow-sm); opacity: ${isCompleted ? '0.85' : '1'};">
            <div style="width: 44px; height: 44px; border-radius: 12px; background: var(--color-bg-secondary); color: var(--color-text-secondary); display: flex; align-items: center; justify-content: center; flex-shrink: 0; border: 1px solid var(--color-border-light);">
              ${icon(avatarIcon, 22)}
            </div>
            <div style="flex: 1; min-width: 0; text-align: left;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
                <span style="font-family: var(--font-display); font-size: 14.5px; font-weight: 850; color: var(--color-text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 70%;">${otherName}</span>
                <span style="font-size: 11px; color: var(--color-text-tertiary); font-weight: 700;">${time}</span>
              </div>
              <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
                <span style="font-size: 10px; font-weight: 800; background: var(--color-primary-light); color: var(--color-primary); padding: 1px 6px; border-radius: 4px;">Pedido #${order.orderNum || '---'}</span>
                ${isCompleted ? `
                  <span style="font-size: 10px; font-weight: 800; background: #e2e8f0; color: #64748b; padding: 1px 6px; border-radius: 4px;">${icon('lock', 8)} Finalizado</span>
                ` : `
                  <span style="font-size: 10px; font-weight: 800; background: #dcfce7; color: #15803d; padding: 1px 6px; border-radius: 4px;">Activo</span>
                `}
              </div>
              <p style="margin: 0; font-size: 12px; color: var(--color-text-secondary); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${lastMsg}</p>
            </div>
            ${isUnread ? `
              <span style="width: 10px; height: 10px; border-radius: 50%; background: var(--color-primary); position: absolute; right: 14px; bottom: 14px;"></span>
            ` : ''}
          </div>
        `;
      }
    });
  }

  if (!currentSupportChat && combinedChats.length === 0) {
    html = `
      <div style="text-align: center; padding: 60px 20px; color: var(--color-text-tertiary); flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%;">
        <div style="font-size: 40px; margin-bottom: 12px;">💬</div>
        <h3 style="margin: 0 0 6px 0; font-size: 16px; font-weight: 800; color: var(--color-text-secondary);">Sin chats activos</h3>
        <p style="margin: 0; font-size: 12.5px; font-weight: 500; line-height: 1.4;">Tus conversaciones de soporte, pedidos y marketplace aparecerán aquí.</p>
      </div>
    `;
  }

  container.innerHTML = html;

  // 1. Attach click listener to Support Chat
  const supportItem = container.querySelector('#open-support-chat-item');
  if (supportItem) {
    supportItem.onclick = () => {
      document.getElementById('support-bot-fab-btn')?.click();
    };
  }

  // 2. Attach click listeners to Order Chats
  const orderItems = container.querySelectorAll('.order-chat-card');
  orderItems.forEach(item => {
    item.onclick = () => {
      const chatId = item.getAttribute('data-chat-id');
      const chat = currentOrderChats.find(c => c.id === chatId);
      if (chat && chat.order) {
        let otherName = 'Usuario';
        const order = chat.order;

        if (user.uid === order.userId) {
          otherName = chat.type === 'client-commerce' ? (order.comercioName || 'Comercio') : (order.driverName || 'Repartidor');
        } else if (order.comercioId && user.uid === order.comercioId || (order.comercioOwnerId && user.uid === order.comercioOwnerId)) {
          otherName = chat.type === 'client-commerce' ? (order.userName || 'Cliente') : (order.driverName || 'Repartidor');
        } else if (user.uid === order.driverId) {
          otherName = chat.type === 'client-delivery' ? (order.userName || 'Cliente') : (order.comercioName || 'Comercio');
        }

        import('../components/chat.js').then(m => {
          m.openChat({
            orderId: chat.orderId,
            type: chat.type,
            otherName: otherName,
            orderNum: order.orderNum,
            senderDisplayName: user.displayName || 'Usuario'
          });
        });
      }
    };
  });

  // 3. Attach click listeners to Marketplace Chats
  const mktItems = container.querySelectorAll('.marketplace-chat-card');
  mktItems.forEach(item => {
    item.onclick = () => {
      const chatId = item.getAttribute('data-chat-id');
      window.location.hash = `#/marketplace/chat/${chatId}`;
    };
  });
}
