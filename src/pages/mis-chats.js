// GoDelivery — Mis Chats Page
import { getState, subscribe } from '../state.js';
import { db } from '../firebase.js';
import { collection, doc, query, where, getDoc, onSnapshot, or } from 'firebase/firestore';
import { icon } from '../utils/icons.js';
import { isAdmin, isComercio } from '../auth.js';

let unsubSupport = null;
let unsubChats = null;
let unsubMarketplace = null;
let currentSupportChats = [];
let currentOrderChats = [];
let currentMarketplaceChats = [];

const userPhotoCache = {};
async function getOrFetchUserPhoto(userId) {
  if (!userId) return null;
  if (userPhotoCache[userId] !== undefined) return userPhotoCache[userId];
  
  userPhotoCache[userId] = null;
  try {
    const { doc, getDoc } = await import('firebase/firestore');
    const userSnap = await getDoc(doc(db, 'users', userId));
    if (userSnap.exists()) {
      const data = userSnap.data();
      let photo = data.photoURL || data.profilePhoto || null;
      const role = data.role;
      if (role === 'comercio' || role === 'commerce') {
        const comSnap = await getDoc(doc(db, 'comercios', userId));
        if (comSnap.exists()) {
          const comData = comSnap.data();
          photo = comData.logo || comData.image || photo;
        }
      }
      userPhotoCache[userId] = photo;
      return photo;
    }
  } catch (e) {
    console.error('[MisChats] Error fetching user photo:', userId, e);
  }
  return null;
}

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
    <style>
      .chat-list-card {
        will-change: transform, box-shadow;
        transition: all 0.28s cubic-bezier(0.16, 1, 0.3, 1) !important;
        touch-action: pan-y;
        user-select: none;
        -webkit-user-select: none;
      }
      .chat-list-card:hover {
        transform: translateY(-2px);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.05) !important;
        border-color: rgba(227, 27, 35, 0.15) !important;
      }
      .chat-list-card:active {
        transform: scale(0.98);
        opacity: 0.9;
      }
    </style>
    <div class="chats-panel-page page-enter" style="display: flex; flex-direction: column; height: 100%; width: 100%; background: var(--color-bg); overflow: hidden; position: relative;">
      <!-- Header -->
      <div style="background: var(--color-primary); padding: ${topPadding} 0 0 0; position: relative; overflow: hidden; border-bottom-left-radius: 28px; border-bottom-right-radius: 28px; box-shadow: 0 8px 32px rgba(225, 29, 72, 0.2); z-index: 100; flex-shrink: 0;">
        <!-- Decorative Circles -->
        <div style="position: absolute; inset: 0; overflow: hidden; border-bottom-left-radius: 28px; border-bottom-right-radius: 28px; pointer-events: none; z-index: 1;">
          <div style="position: absolute; top: -30px; right: -30px; width: 120px; height: 120px; background: rgba(255,255,255,0.08); border-radius: 50%;"></div>
          <div style="position: absolute; bottom: -10px; left: 100px; width: 50px; height: 50px; background: rgba(255,255,255,0.04); border-radius: 50%;"></div>
        </div>

        <div style="height: 56px; padding: 0 20px; display: flex; align-items: center; justify-content: space-between; position: relative; z-index: 2; width: 100%; box-sizing: border-box;">
          <span style="font-weight: 800; font-size: 20px; color: white; font-family: var(--font-display); letter-spacing: -0.02em;">Mis Chats</span>
          
          <div style="display: flex; align-items: center; gap: 8px;">
            <button id="btn-delete-all-chats" style="background: rgba(255,255,255,0.15); border: none; color: white; border-radius: 12px; padding: 8px 12px; display: flex; align-items: center; justify-content: center; transition: all 0.2s; cursor: pointer; font-size: 11px; font-weight: 800; gap: 6px;" onmouseover="this.style.background='rgba(255,255,255,0.25)'" onmouseout="this.style.background='rgba(255,255,255,0.15)'">
              ${icon('trash', 14)} Vaciar
            </button>

            ${isAdmin() || isComercio() ? `
              <a href="#/admin/support-chats" style="font-size: 11px; padding: 8px 14px; text-decoration: none; display: flex; align-items: center; gap: 6px; border-radius: 12px; background: rgba(255,255,255,0.2); color: white; font-weight: 900; transition: all 0.2s; border: none; cursor: pointer;" onmouseover="this.style.background='rgba(255,255,255,0.35)'" onmouseout="this.style.background='rgba(255,255,255,0.2)'">
                ${icon('shield', 12)} Panel Soporte
              </a>
            ` : ''}
          </div>
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

  const btnDeleteAll = content.querySelector('#btn-delete-all-chats');
  if (btnDeleteAll) {
    btnDeleteAll.onclick = () => showDeleteAllChatsModal(user, container);
  }

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
  currentSupportChats = [];
  currentOrderChats = [];
  currentMarketplaceChats = [];
}

function startChatsListener(container, user) {
  cleanup();

  // 1. Listen to support chats
  const supportQuery = query(collection(db, 'support_chats'), where('userId', '==', user.uid));
  unsubSupport = onSnapshot(supportQuery, (snap) => {
    currentSupportChats = snap.docs
      .filter(d => d.id !== user.uid)
      .map(d => ({ id: d.id, isSupport: true, ...d.data() }))
      .filter(c => !c.deletedFor || !c.deletedFor.includes(user.uid));
    renderChats(container, user);
  }, (err) => console.warn('[MisChats] Support listener error:', err));

  // 2. Listen to order chats
  const chatsQuery = query(collection(db, 'chats'), where('participants', 'array-contains', user.uid));
  unsubChats = onSnapshot(chatsQuery, async (snap) => {
    let orderChats = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    orderChats = orderChats.filter(c => !c.deletedFor || !c.deletedFor.includes(user.uid));

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
    currentMarketplaceChats = snap.docs
      .map(d => ({ id: d.id, isMarketplace: true, ...d.data() }))
      .filter(c => !c.deletedFor || !c.deletedFor.includes(user.uid));
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
  
  const combinedChats = [];
  
  // 1. Gather Support Chats
  currentSupportChats.forEach(chat => {
    combinedChats.push({
      ...chat,
      isSupport: true,
      isMarketplace: false,
      sortTime: chat.lastMessageTime?.toDate?.() || chat.lastActivityAt?.toDate?.() || 0
    });
  });

  // 2. Gather Order Chats
  currentOrderChats.filter(c => c.order).forEach(chat => {
    const order = chat.order;
    const isPrimary = user.uid === order.userId || 
                      user.uid === order.driverId || 
                      user.uid === order.comercioId || 
                      (order.comercioOwnerId && user.uid === order.comercioOwnerId);

    if (isAdmin() && !isPrimary) {
      // Skip audited/support chats of other users
      return;
    }

    combinedChats.push({
      ...chat,
      isSupport: false,
      isMarketplace: false,
      sortTime: chat.lastMessageAt?.toDate?.() || chat.lastActivityAt?.toDate?.() || 0
    });
  });
  
  // 3. Gather Marketplace Chats
  currentMarketplaceChats.forEach(chat => {
    combinedChats.push({
      ...chat,
      isSupport: false,
      isMarketplace: true,
      sortTime: chat.lastMessageAt?.toDate?.() || chat.lastActivityAt?.toDate?.() || 0
    });
  });
  
  // 4. Sort chronologically (newest first)
  combinedChats.sort((a, b) => b.sortTime - a.sortTime);

  if (combinedChats.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding:80px 20px; opacity:0.4;">
        ${icon('chatBubble', 48)}
        <p style="font-weight:900; font-size:16px; margin-top:16px;">Sin conversaciones</p>
        <p style="font-size:12px;">Aquí verás tus chats de soporte, pedidos y marketplace</p>
      </div>
    `;
    return;
  }

  combinedChats.forEach(chat => {
    if (chat.isSupport) {
      const isUnread = chat.unreadByUser === true;
      const lastMsg = chat.lastMessageText || 'Conversación iniciada';
      const time = chat.lastMessageTime ? formatTime(chat.lastMessageTime) : '';

      html += `
        <div class="chat-list-card support-chat-card" data-chat-id="${chat.id}" style="display: flex; align-items: center; gap: 12px; padding: 14px; background: var(--color-surface); border: 1.5px solid ${isUnread ? 'var(--color-primary)' : 'var(--color-border-light)'}; border-radius: 20px; cursor: pointer; position: relative; transition: all 0.2s; box-shadow: var(--shadow-sm);">
          <div style="width: 44px; height: 44px; border-radius: 12px; background: linear-gradient(135deg, var(--color-primary), #E31B23); color: white; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 12px rgba(225, 29, 72, 0.2);">
            ${icon('chatBubble', 22)}
          </div>
          <div style="flex: 1; min-width: 0; text-align: left;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
              <div style="display:flex; align-items:center; gap:4px;">
                <span style="font-family: var(--font-display); font-size: 14.5px; font-weight: 850; color: var(--color-text-primary);">Soporte Técnico</span>
                ${chat.status === 'pending' ? `<span style="background: rgba(245,158,11,0.12); color: #d97706; border: 1px solid rgba(245,158,11,0.2); padding: 2px 6px; border-radius: 6px; font-size: 9px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.3px; display:inline-block; vertical-align:middle; line-height:1;">Pendiente</span>` : ''}
              </div>
              <span style="font-size: 11px; color: var(--color-text-tertiary); font-weight: 700;">${time}</span>
            </div>
            <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
              <span style="font-size: 10px; font-weight: 800; background: #e0f2fe; color: #0369a1; padding: 1px 6px; border-radius: 4px;">Ticket ${chat.ticketId || '---'}</span>
            </div>
            <p style="margin: 0; font-size: 12px; color: var(--color-text-secondary); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${lastMsg}</p>
          </div>
          ${isUnread ? `
            <span style="width: 10px; height: 10px; border-radius: 50%; background: var(--color-primary); position: absolute; right: 14px; bottom: 14px;"></span>
          ` : ''}
        </div>
      `;
    } else if (chat.isMarketplace) {
      const otherId = user.uid === chat.buyerId ? chat.sellerId : chat.buyerId;
      const otherName = user.uid === chat.buyerId ? chat.sellerName : chat.buyerName;
      const isUnread = chat.unreadBy && chat.unreadBy.includes(user.uid);
      const lastMsg = chat.lastMessage || 'Conversación iniciada';
      const time = chat.lastMessageAt ? formatTime(chat.lastMessageAt) : '';

      const cachedPhoto = userPhotoCache[otherId];
      if (cachedPhoto === undefined) {
        getOrFetchUserPhoto(otherId).then(() => {
          renderChats(container, user);
        });
      }

      const avatarHtml = cachedPhoto ? `
        <img src="${cachedPhoto}" style="width:100%; height:100%; object-fit:cover; border-radius:12px;" />
      ` : icon('shoppingBag', 22);

      html += `
        <div class="chat-list-card marketplace-chat-card" data-chat-id="${chat.id}" style="display: flex; align-items: center; gap: 12px; padding: 14px; background: var(--color-surface); border: 1.5px solid ${isUnread ? 'var(--color-primary)' : 'var(--color-border-light)'}; border-radius: 20px; cursor: pointer; position: relative; transition: all 0.2s; box-shadow: var(--shadow-sm);">
          <div style="width: 44px; height: 44px; border-radius: 12px; background: var(--color-bg-secondary); color: var(--color-text-secondary); display: flex; align-items: center; justify-content: center; flex-shrink: 0; border: 1px solid var(--color-border-light); overflow:hidden;">
            ${avatarHtml}
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
      const order = chat.order;
      let otherId = null;
      let logoUrl = null;
      let otherName = 'Usuario';
      let avatarIcon = 'user';
      const time = chat.lastMessageAt ? formatTime(chat.lastMessageAt) : '';

      if (user.uid === order.userId) {
        if (chat.type === 'client-commerce') {
          otherName = order.comercioName || 'Comercio';
          avatarIcon = 'store';
          logoUrl = getState().comerciosData?.[order.comercioId] || null;
        } else if (chat.type === 'client-delivery') {
          otherName = order.driverName || 'Repartidor';
          avatarIcon = 'bike';
          otherId = order.driverId;
        }
      } else if (order.comercioId && user.uid === order.comercioId || (order.comercioOwnerId && user.uid === order.comercioOwnerId)) {
        if (chat.type === 'client-commerce') {
          otherName = order.userName || 'Cliente';
          avatarIcon = 'user';
          otherId = order.userId;
        } else if (chat.type === 'commerce-delivery') {
          otherName = order.driverName || 'Repartidor';
          avatarIcon = 'bike';
          otherId = order.driverId;
        }
      } else if (user.uid === order.driverId) {
        if (chat.type === 'client-delivery') {
          otherName = order.userName || 'Cliente';
          avatarIcon = 'user';
          otherId = order.userId;
        } else if (chat.type === 'commerce-delivery') {
          otherName = order.comercioName || 'Comercio';
          avatarIcon = 'store';
          logoUrl = getState().comerciosData?.[order.comercioId] || null;
        }
      }

      // Admin/Support fallback view
      if (otherName === 'Usuario') {
        if (chat.type === 'client-commerce') {
          otherName = order.userName || 'Cliente';
          otherId = order.userId;
          logoUrl = getState().comerciosData?.[order.comercioId] || null;
        } else if (chat.type === 'client-delivery') {
          otherName = order.driverName || 'Repartidor';
          otherId = order.driverId;
        } else if (chat.type === 'commerce-delivery') {
          otherName = order.driverName || 'Repartidor';
          otherId = order.driverId;
        }
      }

      let cachedPhoto = null;
      if (otherId) {
        cachedPhoto = userPhotoCache[otherId];
        if (cachedPhoto === undefined) {
          getOrFetchUserPhoto(otherId).then(() => {
            renderChats(container, user);
          });
        }
      }

      // Premium initials fallback avatar styling
      const nameForInitials = otherName || 'U';
      const initialLetter = nameForInitials.charAt(0).toUpperCase();
      const colors = ['#e11d48', '#16a34a', '#d97706', '#2563eb', '#7c3aed', '#db2777', '#0891b2'];
      const colorIndex = nameForInitials.length % colors.length;
      const initialBg = colors[colorIndex];

      const initialAvatarHtml = `
        <div style="width: 100%; height: 100%; border-radius: 12px; background: ${initialBg}; color: white; display: flex; align-items: center; justify-content: center; font-family: var(--font-display); font-weight: 800; font-size: 16px;">
          ${initialLetter}
        </div>
      `;

      const avatarHtml = logoUrl ? `
        <img src="${logoUrl}" style="width:100%; height:100%; object-fit:cover; border-radius:12px;" />
      ` : (cachedPhoto ? `
        <img src="${cachedPhoto}" style="width:100%; height:100%; object-fit:cover; border-radius:12px;" />
      ` : initialAvatarHtml);

      const isUnread = chat.unread && chat.unread[user.uid] === true;
      const lastMsg = chat.lastMessage || 'Conversación iniciada';
      const isCompleted = order.status === 'completed' || order.status === 'cancelled';
      const realOrderNum = order.orderId || chat.orderId.slice(0, 6).toUpperCase();

      html += `
        <div class="chat-list-card order-chat-card" data-chat-id="${chat.id}" style="display: flex; align-items: center; gap: 12px; padding: 14px; background: var(--color-surface); border: 1.5px solid ${isUnread ? 'var(--color-primary)' : 'var(--color-border-light)'}; border-radius: 20px; cursor: pointer; position: relative; transition: all 0.2s; box-shadow: var(--shadow-sm); opacity: ${isCompleted ? '0.85' : '1'};">
          <div style="width: 44px; height: 44px; border-radius: 12px; background: var(--color-bg-secondary); color: var(--color-text-secondary); display: flex; align-items: center; justify-content: center; flex-shrink: 0; border: 1px solid var(--color-border-light); overflow:hidden;">
            ${avatarHtml}
          </div>
          <div style="flex: 1; min-width: 0; text-align: left;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
              <span style="font-family: var(--font-display); font-size: 14.5px; font-weight: 850; color: var(--color-text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 70%;">${otherName}</span>
              <span style="font-size: 11px; color: var(--color-text-tertiary); font-weight: 700;">${time}</span>
            </div>
            <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
              <span style="font-size: 10px; font-weight: 800; background: var(--color-primary-light); color: var(--color-primary); padding: 1px 6px; border-radius: 4px;">Pedido #${realOrderNum}</span>
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

  container.innerHTML = html;

  // 1. Attach click listeners to Order Chats
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
            orderNum: order.orderId || chat.orderId.slice(0, 6).toUpperCase(),
            senderDisplayName: user.displayName || 'Usuario'
          });
        });
      }
    };
  });

  // 2. Attach click listeners to Marketplace Chats
  const mktItems = container.querySelectorAll('.marketplace-chat-card');
  mktItems.forEach(item => {
    item.onclick = () => {
      const chatId = item.getAttribute('data-chat-id');
      window.location.hash = `#/marketplace/chat/${chatId}`;
    };
  });

  // 3. Attach click listeners to Support Chats (Opens fullscreen modal)
  const supportItems = container.querySelectorAll('.support-chat-card');
  supportItems.forEach(item => {
    item.onclick = () => {
      const chatId = item.getAttribute('data-chat-id');
      const ticketNum = item.querySelector('[style*="Ticket "]')?.textContent?.replace('Ticket ', '')?.trim() || chatId;
      import('../components/support-bot.js').then(m => {
        m.openSupportTicketModal(chatId, ticketNum);
      });
    };
  });

  // Attach long press listeners
  initLongPress(container, user);
}

function initLongPress(container, user) {
  let pressTimer = null;
  let isMoved = false;

  const startPress = (e, card) => {
    isMoved = false;
    if (pressTimer) clearTimeout(pressTimer);
    
    pressTimer = setTimeout(() => {
      if (isMoved) return;
      navigator.vibrate?.([40]);
      const chatId = card.getAttribute('data-chat-id') || 'support';
      const isSupport = card.classList.contains('support-chat-card');
      const isMarketplace = card.classList.contains('marketplace-chat-card');
      
      let chatObj = null;
      if (isSupport) {
        // Find by ticketId since card ID might be different
        const ticketIdAttr = card.querySelector('[style*="Ticket "]')?.textContent?.replace('Ticket ', '')?.trim();
        chatObj = currentSupportChats.find(c => c.ticketId === ticketIdAttr || c.id === chatId) || currentSupportChats[0];
      } else if (isMarketplace) {
        chatObj = currentMarketplaceChats.find(c => c.id === chatId);
      } else {
        chatObj = currentOrderChats.find(c => c.id === chatId);
      }

      if (chatObj) {
        showChatOptionsModal(chatObj, user, container);
      }
    }, 600);
  };

  const cancelPress = () => {
    if (pressTimer) clearTimeout(pressTimer);
  };

  container.querySelectorAll('.chat-list-card').forEach(card => {
    card.addEventListener('pointerdown', (e) => startPress(e, card));
    card.addEventListener('pointerup', cancelPress);
    card.addEventListener('pointerleave', cancelPress);
    card.addEventListener('pointercancel', cancelPress);
    card.addEventListener('pointermove', (e) => {
      if (Math.abs(e.movementX || 0) > 4 || Math.abs(e.movementY || 0) > 4) {
        isMoved = true;
        cancelPress();
      }
    });
  });
}

async function showChatOptionsModal(chat, user, container) {
  const { showModal, closeModal } = await import('../components/modal.js');
  const { doc, updateDoc, arrayUnion } = await import('firebase/firestore');
  
  const modalEl = document.createElement('div');
  modalEl.style.padding = '20px calc(20px + env(safe-area-inset-bottom, 0px)) 20px 20px';
  modalEl.style.display = 'flex';
  modalEl.style.flexDirection = 'column';
  modalEl.style.gap = '14px';
  
  modalEl.innerHTML = `
    <div style="text-align:center; margin-bottom:12px;">
      <h4 style="margin:0 0 4px 0; font-family:var(--font-display); font-size:15px; font-weight:850; color:var(--color-text-primary);">Opciones de Conversación</h4>
      <p style="margin:0; font-size:12px; color:var(--color-text-tertiary); font-weight:700;">Ticket/Pedido: ${chat.ticketId || chat.order?.orderId || chat.orderId?.slice(0, 6).toUpperCase() || 'Soporte'}</p>
    </div>
    
    <button id="btn-delete-chat-single" style="display:flex; align-items:center; justify-content:center; gap:8px; height:50px; border-radius:16px; border:none; background:rgba(227, 27, 35, 0.08); color:var(--color-primary); font-size:14px; font-weight:900; cursor:pointer; width:100%; transition:background 0.2s;">
      ${icon('trash', 18)} Eliminar conversación
    </button>
    
    <button id="btn-cancel-chat-options" style="display:flex; align-items:center; justify-content:center; height:50px; border-radius:16px; border:1.5px solid var(--color-border); background:var(--color-surface); color:var(--color-text-secondary); font-size:14px; font-weight:800; cursor:pointer; width:100%;">
      Cancelar
    </button>
  `;
  
  const mInstance = showModal({
    title: '',
    content: modalEl,
    hideHeader: true,
    height: 'auto'
  });
  
  const delBtn = modalEl.querySelector('#btn-delete-chat-single');
  const cancelBtn = modalEl.querySelector('#btn-cancel-chat-options');
  
  cancelBtn.onclick = () => closeModal(mInstance.id || mInstance);
  
  delBtn.onclick = async () => {
    try {
      closeModal(mInstance.id || mInstance);
      import('../components/toast.js').then(t => t.showToast('Eliminando conversación...', 'info'));
      
      let coll = 'chats';
      if (chat.isSupport) coll = 'support_chats';
      else if (chat.isMarketplace) coll = 'marketplace_chats';
      
      await updateDoc(doc(db, coll, chat.id), {
        deletedFor: arrayUnion(user.uid)
      });
      
      import('../components/toast.js').then(t => t.showToast('Conversación eliminada', 'success'));
    } catch (err) {
      console.error('Error deleting chat:', err);
      import('../components/toast.js').then(t => t.showToast('Error al eliminar conversación', 'error'));
    }
  };
}

async function showDeleteAllChatsModal(user, container) {
  const { showModal, closeModal } = await import('../components/modal.js');
  const { doc, updateDoc, arrayUnion } = await import('firebase/firestore');
  
  const modalEl = document.createElement('div');
  modalEl.style.padding = '20px calc(20px + env(safe-area-inset-bottom, 0px)) 20px 20px';
  modalEl.style.display = 'flex';
  modalEl.style.flexDirection = 'column';
  modalEl.style.gap = '14px';
  
  modalEl.innerHTML = `
    <div style="text-align:center; margin-bottom:12px;">
      <h4 style="margin:0 0 6px 0; font-family:var(--font-display); font-size:16px; font-weight:900; color:var(--color-text-primary);">¿Eliminar todos los chats?</h4>
      <p style="margin:0; font-size:12px; color:var(--color-text-secondary); font-weight:600; line-height:1.5;">Esta acción ocultará definitivamente todas tus conversaciones. El otro participante seguirá teniendo acceso a las mismas.</p>
    </div>
    
    <button id="btn-delete-chats-all-confirm" style="display:flex; align-items:center; justify-content:center; gap:8px; height:50px; border-radius:16px; border:none; background:var(--color-primary); color:white; font-size:14px; font-weight:900; cursor:pointer; width:100%; transition:background 0.2s;">
      ${icon('trash', 18)} ELIMINAR TODOS
    </button>
    
    <button id="btn-cancel-chats-all" style="display:flex; align-items:center; justify-content:center; height:50px; border-radius:16px; border:1.5px solid var(--color-border); background:var(--color-surface); color:var(--color-text-secondary); font-size:14px; font-weight:800; cursor:pointer; width:100%;">
      Cancelar
    </button>
  `;
  
  const mInstance = showModal({
    title: '',
    content: modalEl,
    hideHeader: true,
    height: 'auto'
  });
  
  const delBtn = modalEl.querySelector('#btn-delete-chats-all-confirm');
  const cancelBtn = modalEl.querySelector('#btn-cancel-chats-all');
  
  cancelBtn.onclick = () => closeModal(mInstance.id || mInstance);
  
  delBtn.onclick = async () => {
    try {
      closeModal(mInstance.id || mInstance);
      import('../components/toast.js').then(t => t.showToast('Eliminando conversaciones...', 'info'));
      
      const promises = [];
      
      currentSupportChats.forEach(chat => {
        promises.push(updateDoc(doc(db, 'support_chats', chat.id), {
          deletedFor: arrayUnion(user.uid)
        }).catch(() => {}));
      });
      
      currentOrderChats.forEach(chat => {
        promises.push(updateDoc(doc(db, 'chats', chat.id), {
          deletedFor: arrayUnion(user.uid)
        }).catch(() => {}));
      });
      
      currentMarketplaceChats.forEach(chat => {
        promises.push(updateDoc(doc(db, 'marketplace_chats', chat.id), {
          deletedFor: arrayUnion(user.uid)
        }).catch(() => {}));
      });
      
      await Promise.all(promises);
      import('../components/toast.js').then(t => t.showToast('Conversaciones eliminadas con éxito', 'success'));
    } catch (err) {
      console.error('Error deleting all chats:', err);
      import('../components/toast.js').then(t => t.showToast('Error al eliminar conversaciones', 'error'));
    }
  };
}
