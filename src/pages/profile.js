import { getState, subscribe, getUserLevel } from '../state.js';
import { signInWithGoogle, signOut, isAdmin, isSuperAdmin, isComercio, isDelivery, isLoggedIn } from '../auth.js';
import { db } from '../firebase.js';
import { collection, query, where, getDocs, addDoc, serverTimestamp, onSnapshot } from 'firebase/firestore';
import { icon } from '../utils/icons.js';
import { formatPrice } from '../utils/format.js';
import { showAddressPrompt } from '../components/address-modal.js';
import { AudioManager } from '../utils/audio-manager.js';

export async function renderProfile(content) {
  const { checkIfInstalled, isIOS, showInstallUI } = await import('../components/install-prompt.js');

  const updateInstallVisibility = () => {
    const isInstalled = checkIfInstalled();
    const pwaSkipped = sessionStorage.getItem('pwa_skipped') === 'true';
    const canInstall = window.deferredPrompt !== undefined || isIOS();
    const installRow = document.getElementById('install-app-row');

    if (!isInstalled && !pwaSkipped && canInstall && installRow) {
      installRow.style.display = 'flex';
    } else if (installRow) {
      installRow.style.display = 'none';
    }
  };

  if (!content) return;

  renderProfileContent(content, { updateInstallVisibility, showInstallUI });

  const unsubUser = subscribe('user', () => renderProfileContent(content, { updateInstallVisibility, showInstallUI }));
  const unsubAddress = subscribe('deliveryAddress', () => renderProfileContent(content, { updateInstallVisibility, showInstallUI }));
  const unsubLevels = subscribe('levels', () => renderProfileContent(content, { updateInstallVisibility, showInstallUI }));
  const unsubPointsPerDollar = subscribe('pointsPerDollar', () => renderProfileContent(content, { updateInstallVisibility, showInstallUI }));
  const unsubDollarPerPoint = subscribe('dollarPerPoint', () => renderProfileContent(content, { updateInstallVisibility, showInstallUI }));

  const handlePrompt = () => updateInstallVisibility();
  window.addEventListener('pwa-prompt-available', handlePrompt);

  return {
    cleanup: () => {
      unsubUser();
      unsubAddress();
      unsubLevels();
      unsubPointsPerDollar();
      unsubDollarPerPoint();
      window.removeEventListener('pwa-prompt-available', handlePrompt);
    }
  };
}

async function renderProfileContent(content, { updateInstallVisibility, showInstallUI } = {}) {
  try {
    const user = getState().user;

    if (!user) {
      content.innerHTML = `
        <div class="login-page">
          <div class="login-card page-enter">
            <img src="/logo-brand.jpg" alt="GoDelivery" class="login-logo circular-logo" />
            <h2 class="login-title">¡Bienvenido!</h2>
            <p class="login-subtitle">Iniciá sesión para empezar a pedir lo que más te gusta</p>
            <button class="btn btn-google btn-block btn-lg" id="google-login-btn">
              <svg width="20" height="20" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
              Continuar con Google
            </button>
          </div>
        </div>
      `;

      document.getElementById('google-login-btn')?.addEventListener('click', signInWithGoogle);
      return;
    }

    if (user && !user.goId) {
      const { runTransaction, doc: fDoc } = await import('firebase/firestore');
      runTransaction(db, async (t) => {
        const sRef = fDoc(db, 'settings', 'users');
        const sSnap = await t.get(sRef);
        let last = sSnap.exists() ? sSnap.data().lastGoId || 1000 : 1000;
        last++;
        const goId = `GO-${last}`;
        t.update(fDoc(db, 'users', user.uid), { goId });
        t.set(sRef, { lastGoId: last }, { merge: true });
        user.goId = goId;
      }).catch(err => console.error('Error assigning goId inside profile:', err));
    }

    const { deliveryAddress } = getState();
    const level = getUserLevel(user.completedOrdersCount || 0);

    const s = getState();
    const allLevels = Object.values(s.levels || {}).sort((a, b) => a.minOrders - b.minOrders);
    const currentLevelIndex = allLevels.findIndex(l => l.id === level.id);
    const nextLevel = allLevels[currentLevelIndex + 1] || null;

    let progressBarHtml = '';
    let modalProgressBarHtml = '';
    if (nextLevel) {
      const completed = user.completedOrdersCount || 0;
      const target = nextLevel.minOrders;
      const base = level.minOrders;
      const range = target - base;
      const currentProgress = completed - base;
      const percentage = Math.max(0, Math.min(100, (currentProgress / range) * 100));
      const remaining = target - completed;

      progressBarHtml = `
        <div style="margin-top: 12px; width: 100%; display: flex; flex-direction: column; gap: 4px; z-index: 1;">
          <div style="display: flex; justify-content: space-between; font-size: 10.5px; font-weight: 800; opacity: 0.95; letter-spacing: 0.2px;">
            <span>Progreso a Nivel <strong style="color: ${nextLevel.color || '#fff'}">${nextLevel.name}</strong></span>
            <span>${completed}/${target} pedidos</span>
          </div>
          <div style="width: 100%; height: 6px; background: rgba(0,0,0,0.18); border-radius: 4px; overflow: hidden; border: 0.5px solid rgba(255,255,255,0.15);">
            <div style="width: ${percentage}%; height: 100%; background: linear-gradient(90deg, #ffffff 0%, rgba(255,255,255,0.85) 100%); border-radius: 4px; transition: width 0.8s cubic-bezier(0.34, 1.56, 0.64, 1); box-shadow: 0 0 6px rgba(255,255,255,0.5);"></div>
          </div>
          <div style="font-size: 9.5px; opacity: 0.85; font-weight: 700; margin-top: 1px;">
            ¡Te faltan solo ${remaining} ${remaining === 1 ? 'pedido' : 'pedidos'} para subir a ${nextLevel.name}!
          </div>
        </div>
      `;

      modalProgressBarHtml = `
        <div style="background: var(--color-bg-secondary); border: 1.5px solid var(--color-border-light); border-radius: 18px; padding: 14px 16px; display: flex; flex-direction: column; gap: 8px;">
          <div style="display: flex; justify-content: space-between; font-size: 11px; font-weight: 800; color: var(--color-text-secondary); text-transform: uppercase; letter-spacing: 0.5px;">
            <span>Tu Progreso de Nivel</span>
            <span style="color: var(--color-text-primary); font-weight: 900;">${completed} / ${target} Pedidos</span>
          </div>
          
          <div style="display: flex; align-items: center; gap: 10px; margin: 4px 0;">
            <span style="font-size: 12px; font-weight: 900; color: ${level.color}">${level.name}</span>
            <div style="flex: 1; height: 8px; background: var(--color-border-light); border-radius: 6px; overflow: hidden; position: relative;">
              <div style="width: ${percentage}%; height: 100%; background: linear-gradient(90deg, #f59e0b 0%, #d97706 100%); border-radius: 6px; transition: width 1s cubic-bezier(0.34, 1.56, 0.64, 1);"></div>
            </div>
            <span style="font-size: 12px; font-weight: 900; color: ${nextLevel.color}">${nextLevel.name}</span>
          </div>
          
          <div style="font-size: 12px; color: var(--color-text-secondary); text-align: center; font-weight: 600; line-height: 1.4;">
            ¡Te faltan solo <strong style="color: var(--color-primary); font-weight: 800;">${remaining} ${remaining === 1 ? 'pedido' : 'pedidos'}</strong> para alcanzar el rango <strong style="color: ${nextLevel.color}; font-weight: 800;">${nextLevel.name}</strong> y aumentar tus recompensas!
          </div>
        </div>
      `;
    } else {
      progressBarHtml = `
        <div style="margin-top: 12px; width: 100%; display: flex; flex-direction: column; gap: 4px; z-index: 1;">
          <div style="display: flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 900; color: #fff;">
            <span>${icon('sparkles', 12)}</span> ¡Nivel Máximo Alcanzado!
          </div>
          <div style="width: 100%; height: 6px; background: linear-gradient(90deg, #ffffff 0%, #ffe066 100%); border-radius: 4px; box-shadow: 0 0 8px rgba(255,255,255,0.6);"></div>
          <div style="font-size: 9.5px; opacity: 0.9; font-weight: 700; margin-top: 1px;">
            Estás disfrutando del beneficio máximo (+50% GoPoints y promos exclusivas).
          </div>
        </div>
      `;

      modalProgressBarHtml = `
        <div style="background: var(--color-bg-secondary); border: 1.5px solid var(--color-border-light); border-radius: 18px; padding: 14px 16px; display: flex; flex-direction: column; gap: 8px; text-align: center;">
          <div style="color: #f59e0b; font-size: 24px; margin-bottom: 2px;">👑</div>
          <div style="font-family: var(--font-display); font-size: 15px; font-weight: 900; color: var(--color-text-primary);">¡Usuario de Rango Supremo!</div>
          <div style="font-size: 12px; color: var(--color-text-secondary); font-weight: 600; line-height: 1.4;">
            Alcanzaste el nivel máximo <strong>${level.name}</strong>. Tenés el multiplicador de GoPoints al límite y todos los beneficios premium activos. ¡Gracias por ser parte clave de GoDelivery!
          </div>
        </div>
      `;
    }

    content.innerHTML = `
      <div class="profile-page page-enter" style="display:flex; flex-direction:column; height:100%; background:var(--color-bg); overflow:hidden;">
        
        <style>
          .profile-scroll-container::-webkit-scrollbar {
            display: none !important;
          }
          .profile-scroll-container {
            scrollbar-width: none !important;
            -ms-overflow-style: none !important;
          }
          .profile-page .settings-row {
            padding: 10px 16px !important;
            gap: 12px !important;
          }
          .profile-page .settings-icon-box {
            width: 34px !important;
            height: 34px !important;
            border-radius: 10px !important;
          }
          .profile-page .settings-icon-box svg {
            width: 16px !important;
            height: 16px !important;
          }
          .profile-page .settings-label {
            font-size: 13.5px !important;
            font-weight: 700 !important;
          }
          .profile-page .settings-list {
            gap: 0px !important;
          }
          @keyframes pulse-orange {
            0% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.4); }
            70% { box-shadow: 0 0 0 10px rgba(245, 158, 11, 0); }
            100% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0); }
          }
        </style>

        <div style="flex:1; overflow-y:auto; -webkit-overflow-scrolling: touch; padding-bottom: 12px;" class="profile-scroll-container">
          
          <!-- User Profile Info -->
          <div style="padding:16px 20px; background:var(--color-surface); border-bottom:1px solid var(--color-border-light); display:flex; align-items:center; gap:14px;">
            <div style="position:relative;">
              <img src="${user.photoURL || '/logo.png'}" alt="${user.displayName}" style="width:58px; height:58px; border-radius:18px; object-fit:cover; border:2.5px solid var(--color-bg-secondary); box-shadow:var(--shadow-md);" referrerpolicy="no-referrer" />
              <div style="position:absolute; bottom:-3px; right:-3px; width:22px; height:22px; border-radius:8px; background:${level.color}; display:flex; align-items:center; justify-content:center; color:white; border:2.5px solid var(--color-surface);">
                ${icon(level.icon || 'award', 11)}
              </div>
            </div>
            <div style="flex:1; min-width:0;">
              <h2 style="font-family:var(--font-display); font-weight:900; font-size:18px; color:var(--color-text); margin:0; letter-spacing:-0.03em;">${user.displayName || 'Usuario'}</h2>
              <p style="font-size:12px; color:var(--color-text-tertiary); margin:2px 0 0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${user.email || ''} • <strong style="color:var(--color-text-primary); font-family:monospace; letter-spacing:0.5px;">${user.goId || '...'}</strong></p>
              <div style="font-size: 10px; font-weight: 800; color:var(--color-primary); margin-top:4px; text-transform:uppercase; letter-spacing:0.05em; display:flex; align-items:center; gap:4px;">
                Nivel ${level.name} • 
                <span style="display:inline-flex; align-items:center; gap:2.5px; background:rgba(245, 158, 11, 0.1); color:#f59e0b; padding:1.5px 5px; border-radius:5px; font-weight:900; text-transform:none;">
                  ${icon('goPointsLogo', 10)} ${user.points || 0} pts
                </span>
              </div>
            </div>
          </div>

          <!-- Premium GoPoints Badge / Card -->
          <div id="gopoints-badge-card" style="margin: 10px 20px; background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); border-radius: 16px; padding: 14px 16px; color: white; display: flex; flex-direction: column; cursor: pointer; box-shadow: 0 8px 20px -5px rgba(245, 158, 11, 0.3); position: relative; overflow: hidden; transition: all 0.25s; border: 1.5px solid rgba(255,255,255,0.1);" onmouseover="this.style.transform='translateY(-1px)'; this.style.boxShadow='0 10px 24px -5px rgba(245, 158, 11, 0.4)';" onmouseout="this.style.transform='none'; this.style.boxShadow='0 8px 20px -5px rgba(245, 158, 11, 0.3)';">
            <!-- Glow background effects -->
            <div style="position: absolute; right: -10px; top: -10px; width: 80px; height: 80px; background: rgba(255, 255, 255, 0.15); border-radius: 50%; filter: blur(15px);"></div>
            <div style="position: absolute; left: -10px; bottom: -20px; width: 60px; height: 60px; background: rgba(0, 0, 0, 0.1); border-radius: 50%; filter: blur(10px);"></div>
            
            <div style="display: flex; align-items: center; justify-content: space-between; width: 100%; z-index: 1;">
              <div style="display: flex; align-items: center; gap: 10px;">
                <div style="width: 36px; height: 36px; background: rgba(255, 255, 255, 0.2); border-radius: 10px; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(5px); box-shadow: 0 3px 8px rgba(0,0,0,0.06);">
                  ${icon('goPointsLogo', 20)}
                </div>
                <div>
                  <div style="font-size: 10px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.6px; opacity: 0.9;">Mis GO Points</div>
                  <div style="font-size: 20px; font-weight: 950; letter-spacing: -0.5px; margin-top: 1px; display: flex; align-items: baseline; gap: 3px;">
                    ${user.points || 0} 
                    <span style="font-size: 11px; font-weight: 800; opacity: 0.9; letter-spacing: 0.5px;">PTS</span>
                  </div>
                </div>
              </div>
              
              <div style="display: flex; align-items: center; gap: 3px; background: rgba(255, 255, 255, 0.2); padding: 5px 10px; border-radius: 8px; font-size: 10px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.5px; border: 1px solid rgba(255, 255, 255, 0.2); backdrop-filter: blur(4px);">
                Club GO ${icon('chevronRight', 8)}
              </div>
            </div>
            
            ${progressBarHtml}
          </div>

          <!-- Delivery Application Section -->
          ${!isDelivery() ? `
            <div id="delivery-apply-card" style="margin: 10px 20px; background: var(--color-surface); border-radius: 16px; padding: 16px; border: 1.5px solid var(--color-border-light); box-shadow: var(--shadow-sm); display: flex; flex-direction: column; gap: 12px; position: relative; overflow: hidden;">
              ${user.deliveryStatus === 'pending' ? `
                <div style="display: flex; gap: 12px; align-items: flex-start;">
                  <div style="width: 40px; height: 40px; border-radius: 12px; background: rgba(245, 158, 11, 0.1); color: #f59e0b; display: flex; align-items: center; justify-content: center; flex-shrink: 0; animation: pulse-orange 2s infinite;">
                    ${icon('bike', 22)}
                  </div>
                  <div>
                    <h4 style="font-size: 14.5px; font-weight: 800; color: var(--color-text); margin: 0 0 4px 0;">Postulación en Revisión</h4>
                    <p style="font-size: 12px; color: var(--color-text-secondary); margin: 0; line-height: 1.45;">
                      Tu solicitud profesional para ser repartidor está siendo evaluada por un administrador. Te notificaremos pronto.
                    </p>
                  </div>
                </div>
                <div style="display: flex; align-items: center; gap: 6px; background: rgba(245, 158, 11, 0.08); padding: 6px 12px; border-radius: 8px; color: #f59e0b; font-size: 11px; font-weight: 800; align-self: flex-start;">
                  <div class="spinner-mini" style="width:12px; height:12px; border-width:2px; border-top-color:#f59e0b; margin:0;"></div>
                  EN REVISIÓN
                </div>
              ` : user.deliveryStatus === 'rejected' ? `
                <div style="display: flex; gap: 12px; align-items: flex-start;">
                  <div style="width: 40px; height: 40px; border-radius: 12px; background: rgba(239, 68, 68, 0.1); color: #ef4444; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                    ${icon('alertCircle', 22)}
                  </div>
                  <div>
                    <h4 style="font-size: 14.5px; font-weight: 800; color: var(--color-text); margin: 0 0 4px 0;">Postulación Rechazada</h4>
                    <p style="font-size: 12px; color: var(--color-text-secondary); margin: 0; line-height: 1.45;">
                      Tu postulación no ha sido aprobada en este momento. Si crees que se trata de un error, contactá con soporte.
                    </p>
                  </div>
                </div>
                <button id="reapply-delivery-btn" class="btn btn-outline" style="height: 38px; font-size: 12px; font-weight: 800; border-radius: 8px; align-self: flex-start; padding: 0 16px;">
                  Volver a Postularse
                </button>
              ` : `
                <div style="display: flex; gap: 12px; align-items: flex-start;">
                  <div style="width: 40px; height: 40px; border-radius: 12px; background: rgba(var(--color-primary-rgb), 0.1); color: var(--color-primary); display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                    ${icon('bike', 22)}
                  </div>
                  <div>
                    <h4 style="font-size: 14.5px; font-weight: 800; color: var(--color-text); margin: 0 0 4px 0;">¿Querés ser Repartidor?</h4>
                    <p style="font-size: 12px; color: var(--color-text-secondary); margin: 0; line-height: 1.45;">
                      Trabajá con total libertad de horarios, sumá excelentes ingresos semanales y sé tu propio jefe.
                    </p>
                  </div>
                </div>
                <button id="apply-delivery-btn" class="btn btn-primary" style="height: 38px; font-size: 12px; font-weight: 800; border-radius: 8px; align-self: flex-start; padding: 0 16px; background: var(--color-primary); border: none; color: white;">
                  Postularse Ahora
                </button>
              `}
            </div>
          ` : `
            <!-- Panel Repartidor Acceso Directo si ya está aprobado -->
            <div style="margin: 10px 20px; background: rgba(34, 197, 94, 0.05); border-radius: 16px; padding: 14px 16px; border: 1.5px solid rgba(34, 197, 94, 0.2); display: flex; align-items: center; justify-content: space-between; gap: 12px;">
              <div style="display:flex; align-items:center; gap:12px;">
                <div style="width: 36px; height: 36px; border-radius: 10px; background: rgba(34, 197, 94, 0.1); color: #22c55e; display: flex; align-items: center; justify-content: center;">
                  ${icon('bike', 20)}
                </div>
                <div>
                  <div style="font-size:13px; font-weight:800; color:var(--color-text-primary); margin-top:1px;">¡Sos Repartidor Activo!</div>
                  <div style="font-size:11px; color:var(--color-text-secondary); margin-top:1px;">Accedé a tus herramientas y pedidos.</div>
                </div>
              </div>
              <a href="#/delivery" class="btn btn-success" style="height: 32px; font-size: 11px; font-weight: 900; border-radius: 8px; display:flex; align-items:center; gap:4px; text-transform:uppercase; padding:0 12px; background:#22c55e; border:none; color:white; text-decoration:none;">
                Entrar ${icon('chevronRight', 10)}
              </a>
            </div>
          `}

          <!-- Módulo 1.1: Sistema de Referidos & 1.2 Desafíos y Rachas Semanales -->
          <div style="margin: 10px 20px; display: flex; flex-direction: column; gap: 10px;">
            <!-- Referidos Card -->
            <div style="background: var(--color-surface); border-radius: 16px; padding: 16px; border: 1.5px solid var(--color-border-light); box-shadow: var(--shadow-sm); display: flex; flex-direction: column; gap: 12px; position: relative; overflow: hidden;">
              <div style="display: flex; gap: 12px; align-items: flex-start;">
                <div style="width: 40px; height: 40px; border-radius: 12px; background: rgba(245, 158, 11, 0.1); color: #f59e0b; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                  ${icon('gift', 22)}
                </div>
                <div style="flex: 1; min-width: 0;">
                  <h4 style="font-size: 14.5px; font-weight: 800; color: var(--color-text-primary); margin: 0 0 4px 0;">Traé a un amigo, ¡ganan ambos!</h4>
                  <p style="font-size: 12px; color: var(--color-text-secondary); margin: 0; line-height: 1.45;">
                    Compartí tu código único. Cuando tu referido complete su primer pedido, ¡les acreditamos <strong>500 GO Points</strong> a cada uno!
                  </p>
                </div>
              </div>
              
              <div style="background: var(--color-bg-secondary); border-radius: 12px; padding: 8px 12px; display: flex; align-items: center; justify-content: space-between; border: 1px solid var(--color-border-light);">
                <span style="font-family: var(--font-display); font-weight: 900; font-size: 14px; color: var(--color-text-primary); letter-spacing: 0.5px;">
                  ${user.referralCode || 'GO-REF-XXXXX'}
                </span>
                <div style="display: flex; gap: 6px;">
                  <button id="copy-ref-btn" class="btn btn-ghost" style="height: 32px; padding: 0 8px; font-size: 11px; font-weight: 800; border-radius: 6px; display: flex; align-items: center; gap: 4px; border: 1px solid var(--color-border-light); color: var(--color-text-secondary);">
                    ${icon('copy', 13)} Copiar
                  </button>
                  <button id="share-ref-btn" class="btn btn-primary" style="height: 32px; padding: 0 8px; font-size: 11px; font-weight: 800; border-radius: 6px; display: flex; align-items: center; gap: 4px; border: none; color: white; background: var(--color-primary);">
                    ${icon('share', 13)} Compartir
                  </button>
                </div>
              </div>
            </div>
            
            <!-- Desafíos de la Semana Card -->
            <div id="weekly-challenges-card" style="background: var(--color-surface); border-radius: 16px; padding: 16px; border: 1.5px solid var(--color-border-light); box-shadow: var(--shadow-sm); display: flex; gap: 12px; align-items: center; justify-content: space-between; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.transform='translateY(-1px)'" onmouseout="this.style.transform='none'">
              <div style="display: flex; gap: 12px; align-items: center;">
                <div style="width: 40px; height: 40px; border-radius: 12px; background: rgba(59, 130, 246, 0.1); color: #3b82f6; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                  ${icon('target', 22)}
                </div>
                <div>
                  <h4 style="font-size: 14.5px; font-weight: 800; color: var(--color-text-primary); margin: 0 0 2px 0;">Desafíos y Rachas Semanales</h4>
                  <p style="font-size: 11px; color: var(--color-text-secondary); margin: 0;">
                    Completá misiones y sumá bonus de puntos.
                  </p>
                </div>
              </div>
              <div style="color: var(--color-text-tertiary);">
                ${icon('chevronRight', 16)}
              </div>
            </div>

            <!-- Transferir Puntos Card -->
            <div id="transfer-gopoints-card" style="background: var(--color-surface); border-radius: 16px; padding: 16px; border: 1.5px solid var(--color-border-light); box-shadow: var(--shadow-sm); display: flex; gap: 12px; align-items: center; justify-content: space-between; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.transform='translateY(-1px)'" onmouseout="this.style.transform='none'">
              <div style="display: flex; gap: 12px; align-items: center;">
                <div style="width: 40px; height: 40px; border-radius: 12px; background: rgba(16, 185, 129, 0.1); color: #10b981; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                  ${icon('share', 22)}
                </div>
                <div>
                  <h4 style="font-size: 14.5px; font-weight: 800; color: var(--color-text-primary); margin: 0 0 2px 0;">Regalar GO Points</h4>
                  <p style="font-size: 11px; color: var(--color-text-secondary); margin: 0;">
                    Transferí tus puntos a otro usuario usando su ID.
                  </p>
                </div>
              </div>
              <div style="color: var(--color-text-tertiary);">
                ${icon('chevronRight', 16)}
              </div>
            </div>
          </div>

        <!-- Settings Menu List -->
        <div style="margin-top:6px; padding:0 20px;">
          <div class="settings-list" style="background:var(--color-surface); border-radius:16px; border:1px solid var(--color-border-light); overflow:hidden; box-shadow:var(--shadow-sm);">
            
            <a href="#/profile/orders" class="settings-row">
              <div class="settings-icon-box" style="background:rgba(245, 158, 11, 0.1); color:#f59e0b;">
                ${icon('shoppingBag', 20)}
              </div>
              <span class="settings-label">Mis Pedidos</span>
              ${icon('chevronRight', 16, 'settings-chevron')}
            </a>

            <div class="settings-row" id="edit-address-btn">
              <div class="settings-icon-box" style="background:rgba(34, 197, 94, 0.1); color:#10b981;">
                ${icon('mapPin', 20)}
              </div>
              <div style="flex:1;">
                <span class="settings-label">Dirección de Entrega</span>
                <p style="font-size:11px; color:var(--color-text-tertiary); margin:2px 0 0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${deliveryAddress || 'No establecida'}</p>
              </div>
              ${icon('edit', 16, 'settings-chevron')}
            </div>

            <div class="settings-row" id="toggle-theme-btn" style="cursor:pointer;">
              <div class="settings-icon-box" style="background:rgba(14, 165, 233, 0.1); color:#0ea5e9;">
                ${icon('moon', 20)}
              </div>
              <div style="flex:1;">
                <span class="settings-label">Modo Oscuro</span>
              </div>
              <div class="theme-toggle-switch" style="position:relative; width:46px; height:24px; background:${localStorage.getItem('gd-theme') === 'dark' ? 'var(--color-primary)' : 'var(--color-bg-secondary)'}; border-radius:12px; transition:all 0.3s ease;">
                <div class="theme-toggle-handle" style="position:absolute; top:2px; left:${localStorage.getItem('gd-theme') === 'dark' ? '24px' : '2px'}; width:20px; height:20px; background:var(--color-surface); border-radius:50%; box-shadow:0 1.5px 3px rgba(0,0,0,0.2); transition:all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);"></div>
              </div>
            </div>

            <div class="settings-row" id="help-terms-btn" style="cursor:pointer;">
              <div class="settings-icon-box" style="background:rgba(139, 92, 246, 0.1); color:#8b5cf6;">
                ${icon('info', 20)}
              </div>
              <div style="flex:1;">
                <span class="settings-label">Soporte y Términos Legales</span>
              </div>
              ${icon('chevronRight', 16, 'settings-chevron')}
            </div>

            ${isAdmin() ? `
              <a href="#/admin" class="settings-row">
                <div class="settings-icon-box" style="background:rgba(139, 92, 246, 0.1); color:#8b5cf6;">
                  ${icon('shield', 20)}
                </div>
                <span class="settings-label">Panel Administrativo</span>
                ${icon('chevronRight', 16, 'settings-chevron')}
              </a>
            ` : ''}

            <div class="settings-row" id="install-app-row" style="display:none;">
              <div class="settings-icon-box" style="background:rgba(236, 72, 153, 0.1); color:#ec4899;">
                ${icon('plus', 20)}
              </div>
              <span class="settings-label">Instalar Aplicación</span>
              ${icon('plus', 16, 'settings-chevron')}
            </div>

          </div>

          <button class="btn btn-ghost btn-block" id="logout-btn" style="margin-top:14px; height:46px; border-radius:12px; color:var(--color-danger); font-weight:800; background:rgba(var(--color-danger-rgb), 0.05); font-size:14px;">
            ${icon('logOut', 16)} Cerrar sesión
          </button>

          <p style="text-align:center; margin-top:8px; font-size:10px; color:var(--color-text-tertiary); font-weight:600;">GoDelivery v2.4.0 — Made with ❤️</p>
        </div>

      </div>
    `;

    // Listeners
    document.getElementById('edit-address-btn')?.addEventListener('click', () => showAddressPrompt());
    document.getElementById('install-app-row')?.addEventListener('click', () => showInstallUI());
    document.getElementById('help-terms-btn')?.addEventListener('click', () => showHelpAndTermsModal());

    // Módulo 1.1 & 1.2: Referral and Challenges Listeners
    document.getElementById('copy-ref-btn')?.addEventListener('click', async () => {
      AudioManager.hapticLight();
      const code = user.referralCode || 'GO-REF-XXXXX';
      navigator.clipboard.writeText(code);
      const { showToast } = await import('../components/toast.js');
      showToast('¡Código de referido copiado!', 'success');
    });

    document.getElementById('share-ref-btn')?.addEventListener('click', async () => {
      AudioManager.hapticLight();
      const code = user.referralCode || 'GO-REF-XXXXX';
      const shareUrl = `${window.location.origin}/?ref=${code}`;
      const shareData = {
        title: 'GO Delivery — ¡Te regalo un descuento!',
        text: `Registrate en GO Delivery usando mi código ${code} y ganá $500 en GO Points para tu primera compra:`,
        url: shareUrl
      };

      const { showToast } = await import('../components/toast.js');
      if (navigator.share) {
        try {
          await navigator.share(shareData);
        } catch (err) {
          console.warn('Share API failed:', err);
        }
      } else {
        navigator.clipboard.writeText(shareUrl);
        showToast('¡Enlace de invitación copiado!', 'success');
      }
    });

    document.getElementById('weekly-challenges-card')?.addEventListener('click', () => {
      AudioManager.hapticLight();
      document.getElementById('gopoints-badge-card')?.click();
    });

    document.getElementById('transfer-gopoints-card')?.addEventListener('click', () => {
      AudioManager.hapticLight();
      showTransferGoPointsModal(user);
    });

    const toggleBtn = document.getElementById('toggle-theme-btn');
    if (toggleBtn) {
      toggleBtn.onclick = () => {
        AudioManager.hapticLight();
        const currentTheme = localStorage.getItem('gd-theme') || 'light';
        const newTheme = currentTheme === 'light' ? 'dark' : 'light';
        
        localStorage.setItem('gd-theme', newTheme);
        document.documentElement.setAttribute('data-theme', newTheme);
        
        const toggleSwitch = toggleBtn.querySelector('.theme-toggle-switch');
        const toggleHandle = toggleBtn.querySelector('.theme-toggle-handle');
        if (toggleSwitch && toggleHandle) {
          if (newTheme === 'dark') {
            toggleSwitch.style.background = 'var(--color-primary)';
            toggleHandle.style.left = '24px';
          } else {
            toggleSwitch.style.background = 'var(--color-bg-secondary)';
            toggleHandle.style.left = '2px';
          }
        }
      };
    }

    document.getElementById('gopoints-badge-card')?.addEventListener('click', async () => {
      const { showModal } = await import('../components/modal.js');
      const { getState } = await import('../state.js');
      const s = getState();
      const dollarPerPoint = s.dollarPerPoint || 1;
      const pointsPerDollar = s.pointsPerDollar || 0.01;
      const purchaseAmountPerPoint = pointsPerDollar > 0 ? Math.round(1 / pointsPerDollar) : 100;
      
      const allLevels = Object.values(s.levels || {}).sort((a, b) => a.minOrders - b.minOrders);
      const levelsHtml = allLevels.map(lvl => {
        const isCurrent = level.id === lvl.id;
        const multiplierPercent = Math.round((lvl.multiplier - 1.0) * 100);
        const multiplierText = lvl.multiplier > 1.0 
          ? `+${multiplierPercent}% extra de puntos` 
          : `Tasa base de puntos`;
          
        return `
          <div style="background: ${isCurrent ? 'rgba(var(--color-primary-rgb), 0.04)' : 'var(--color-bg-page)'}; border: 1.5px solid ${isCurrent ? 'var(--color-primary)' : 'var(--color-border-light)'}; border-radius: 16px; padding: 10px 12px; display: flex; align-items: center; justify-content: space-between; gap: 10px; transition: all 0.2s;">
            <div style="display: flex; align-items: center; gap: 10px; min-width: 0;">
              <div style="width: 32px; height: 32px; background: ${lvl.color || '#ccc'}; color: white; border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-size: 15px; box-shadow: 0 2px 6px rgba(0,0,0,0.06);">
                ${icon(lvl.icon || 'award', 16)}
              </div>
              <div style="min-width: 0; overflow: hidden;">
                <div style="font-size: 12px; font-weight: 900; color: var(--color-text-primary); display: flex; align-items: center; gap: 6px; white-space: nowrap;">
                  ${lvl.name}
                  ${isCurrent ? `<span style="background:var(--color-primary); color:white; font-size:8px; font-weight:900; padding:1px 5px; border-radius:4px; text-transform:uppercase; letter-spacing:0.02em;">Tú</span>` : ''}
                </div>
                <div style="font-size: 10px; color: var(--color-text-secondary); opacity: 0.8; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                  Desde ${lvl.minOrders} pedidos
                </div>
              </div>
            </div>
            <div style="text-align: right; flex-shrink: 0;">
              <div style="font-size: 12px; font-weight: 900; color: var(--color-success);">${lvl.multiplier}x Puntos</div>
              <div style="font-size: 9px; color: var(--color-text-tertiary); font-weight: 700; margin-top: 1px;">${multiplierText}</div>
            </div>
          </div>
        `;
      }).join('');
      
      showModal({
        title: 'Club GO Points',
        height: 'auto',
        content: `
          <div style="padding: 24px 20px; color: var(--color-text-primary); font-family: var(--font-body); display: flex; flex-direction: column; gap: 20px; max-height: 75dvh; overflow-y: auto;">
            
            <!-- Hero Header -->
            <div style="text-align: center; display: flex; flex-direction: column; align-items: center; gap: 10px; margin-bottom: 4px;">
              <div style="width: 64px; height: 64px; background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: white; border-radius: 20px; display: flex; align-items: center; justify-content: center; box-shadow: 0 8px 24px rgba(245, 158, 11, 0.3);">
                ${icon('goPointsLogo', 38)}
              </div>
              <h4 style="font-family: var(--font-display); font-size: 20px; font-weight: 900; margin: 0; letter-spacing: -0.5px;">¡Bienvenido a GO Points!</h4>
              <p style="font-size: 13px; color: var(--color-text-secondary); margin: 0; line-height: 1.4; max-width: 280px; opacity: 0.85;">
                El programa de fidelidad de GO Delivery que te devuelve dinero en cada compra.
              </p>
            </div>

            <!-- Gamified Progress Bar Inside Modal -->
            ${modalProgressBarHtml}

            <!-- Desafíos Semanales Section (Dynamic) -->
            <div id="modal-challenges-container" style="display: flex; flex-direction: column; gap: 10px;">
              <div style="font-size: 11px; font-weight: 900; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px;">
                Desafíos de la Semana
              </div>
              <div style="display: flex; align-items: center; justify-content: center; padding: 20px; gap: 8px; color: var(--color-text-secondary); font-size: 12px; font-weight: 700;">
                <div class="spinner-mini" style="width:14px; height:14px; border-width:2.5px; border-top-color:var(--color-primary); margin:0;"></div>
                Cargando desafíos...
              </div>
            </div>

            <!-- Bullet Points info -->
            <div style="display: flex; flex-direction: column; gap: 16px;">
              
              <!-- Suma -->
              <div style="display: flex; gap: 12px; align-items: flex-start;">
                <div style="width: 32px; height: 32px; background: rgba(245, 158, 11, 0.1); color: #f59e0b; border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-weight: 900;">
                  ${icon('trendingUp', 16)}
                </div>
                <div>
                  <h5 style="font-size: 13px; font-weight: 800; margin: 0 0 3px 0;">1. Acumulás en cada compra</h5>
                  <p style="font-size: 12px; color: var(--color-text-secondary); margin: 0; line-height: 1.4; opacity: 0.85;">
                    Con cada pedido sumás automáticamente. Ganás <strong>1 punto por cada $${purchaseAmountPerPoint}</strong> en compras de productos, multiplicado por tu multiplicador de nivel.
                  </p>
                </div>
              </div>

              <!-- Canjea -->
              <div style="display: flex; gap: 12px; align-items: flex-start;">
                <div style="width: 32px; height: 32px; background: rgba(16, 185, 129, 0.1); color: #10b981; border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-weight: 900;">
                  ${icon('goPointsLogo', 16)}
                </div>
                <div>
                  <h5 style="font-size: 13px; font-weight: 800; margin: 0 0 3px 0;">2. Canjeá directamente en el Carrito</h5>
                  <p style="font-size: 12px; color: var(--color-text-secondary); margin: 0; line-height: 1.4; opacity: 0.85;">
                    Cada punto vale <strong>${formatPrice(dollarPerPoint)}</strong>. En tu carrito podés ingresar el monto exacto de puntos que querés usar para descontar dinero de tu compra al instante.
                  </p>
                </div>
              </div>

              <!-- Absorbido -->
              <div style="display: flex; gap: 12px; align-items: flex-start;">
                <div style="width: 32px; height: 32px; background: rgba(59, 130, 246, 0.1); color: #3b82f6; border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-weight: 900;">
                  ${icon('shieldCheck', 16)}
                </div>
                <div>
                  <h5 style="font-size: 13px; font-weight: 800; margin: 0 0 3px 0;">3. Absorbido por GO Delivery</h5>
                  <p style="font-size: 12px; color: var(--color-text-secondary); margin: 0; line-height: 1.4; opacity: 0.85;">
                    El descuento por tus GoPoints es 100% absorbido por la plataforma. Tus repartidores favoritos no pierden ganancias; GO Delivery compensa su trabajo reduciendo su deuda en la app.
                  </p>
                </div>
              </div>

            </div>

            <!-- Multiplier Transparent Explainer -->
            <div style="background: linear-gradient(135deg, rgba(245, 158, 11, 0.05) 0%, rgba(245, 158, 11, 0.01) 100%); border: 1.5px dashed rgba(245, 158, 11, 0.3); border-radius: 18px; padding: 16px; display: flex; flex-direction: column; gap: 10px; margin-top: 4px;">
              <div style="display: flex; align-items: center; gap: 8px; color: #d97706;">
                <div style="color: #f59e0b; display: flex; align-items: center;">${icon('sparkles', 16)}</div>
                <span style="font-size: 13px; font-weight: 900; letter-spacing: -0.2px;">¿Cómo funcionan los Multiplicadores?</span>
              </div>
              <p style="font-size: 12px; color: var(--color-text-secondary); margin: 0; line-height: 1.5;">
                Tu nivel depende de tus pedidos completados. Cada nivel multiplica la tasa base de reembolso de puntos:
              </p>
              
              <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 4px; background: rgba(0, 0, 0, 0.02); padding: 12px; border-radius: 12px; border: 1px solid var(--color-border-light);">
                <div style="display: flex; justify-content: space-between; font-size: 10px; font-weight: 800; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: 0.5px;">
                  <span>Concepto</span>
                  <span>Valor Actual</span>
                </div>
                <hr style="border: 0; border-top: 1px solid var(--color-border-light); margin: 4px 0;" />
                <div style="display: flex; justify-content: space-between; font-size: 12px;">
                  <span style="color: var(--color-text-secondary); font-weight: 555;">Tasa Reembolso Base:</span>
                  <span style="font-weight: 800; color: var(--color-text-primary);">${(pointsPerDollar * 100).toFixed(1)}%</span>
                </div>
                <div style="display: flex; justify-content: space-between; font-size: 12px;">
                  <span style="color: var(--color-text-secondary); font-weight: 555;">Tu Nivel Actual:</span>
                  <span style="font-weight: 800; color: ${level.color || 'var(--color-primary)'};">${level.name}</span>
                </div>
                <div style="display: flex; justify-content: space-between; font-size: 12px;">
                  <span style="color: var(--color-text-secondary); font-weight: 555;">Tu Multiplicador:</span>
                  <span style="font-weight: 800; color: var(--color-success);">${level.multiplier}x Puntos</span>
                </div>
                <hr style="border: 0; border-top: 1px dashed var(--color-border-light); margin: 4px 0;" />
                <div style="display: flex; justify-content: space-between; font-size: 12px; align-items: baseline;">
                  <span style="font-weight: 800; color: var(--color-text-primary);">Reembolso Efectivo:</span>
                  <span style="font-weight: 950; color: #f59e0b; font-size: 14px;">${((pointsPerDollar * level.multiplier) * 100).toFixed(2)}%</span>
                </div>
              </div>
              
              <div style="font-size: 11.5px; color: var(--color-text-tertiary); line-height: 1.45; display: flex; gap: 6px; align-items: flex-start; margin-top: 2px;">
                <div style="flex-shrink: 0; margin-top: 2px; color: #f59e0b;">${icon('info', 12)}</div>
                <span>
                  <strong>Ejemplo real:</strong> Con una compra de <strong>$1.000</strong> en productos, acumulás <strong>${Math.floor(1000 * pointsPerDollar * level.multiplier)} puntos</strong> directos. Estos puntos equivalen a <strong>${formatPrice(Math.floor(1000 * pointsPerDollar * level.multiplier) * dollarPerPoint)}</strong> de descuento para usar cuando quieras.
                </span>
              </div>
            </div>

            <!-- Niveles Dinámicos -->
            <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 4px;">
              <h5 style="font-size: 11px; font-weight: 900; color: var(--color-text-tertiary); text-transform: uppercase; margin: 0 0 4px 0; letter-spacing: 0.5px;">Tabla de Niveles & Multiplicadores</h5>
              <div style="display: flex; flex-direction: column; gap: 8px;">
                ${levelsHtml}
              </div>
            </div>

            <!-- Current status block -->
            <div style="background: var(--color-bg-secondary); border-radius: 16px; border: 1.5px solid var(--color-border-light); padding: 14px 16px; display: flex; justify-content: space-between; align-items: center;">
              <div>
                <div style="font-size: 10px; font-weight: 800; color: var(--color-text-tertiary); text-transform: uppercase;">Tu saldo de puntos</div>
                <div style="font-size: 18px; font-weight: 900; color: #f59e0b; display: flex; align-items: center; gap: 4px; margin-top: 2px;">
                  ${icon('goPointsLogo', 16)} ${user.points || 0} pts
                </div>
              </div>
              <div style="text-align: right;">
                <div style="font-size: 10px; font-weight: 800; color: var(--color-text-tertiary); text-transform: uppercase;">Equivalencia en dinero</div>
                <div style="font-size: 18px; font-weight: 900; color: #10b981; margin-top: 2px;">
                  ${formatPrice((user.points || 0) * dollarPerPoint)}
                </div>
              </div>
            </div>

            <button class="btn btn-primary btn-block" onclick="this.closest('.modal-stack-wrapper').querySelector('.modal-close').click()" style="height: 48px; border-radius: 14px; font-size: 13px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.5px; border: none; margin-top: 4px;">
              ¡Entendido!
            </button>
            
          </div>
        `,
        onOpen: () => {
          loadAndRenderModalChallenges(user.uid);
        }
      });
    });

    document.getElementById('logout-btn')?.addEventListener('click', async () => {
      const { showConfirm } = await import('../components/modal.js');
      showConfirm({
        title: 'Cerrar sesión',
        message: '¿Estás seguro de que deseas salir de tu cuenta?',
        confirmText: 'Cerrar sesión',
        danger: true,
        onConfirm: async () => await signOut()
      });
    });

    document.getElementById('apply-delivery-btn')?.addEventListener('click', () => showDeliveryApplicationModal(user));
    document.getElementById('reapply-delivery-btn')?.addEventListener('click', () => showDeliveryApplicationModal(user));

    updateInstallVisibility?.();
  } catch (err) {
    console.error('Error rendering profile content:', err);
    content.innerHTML = '<div class="empty-state">Ocurrió un error al cargar el perfil.</div>';
  }
}

async function showDeliveryApplicationModal(user) {
  const { showModal, closeModal } = await import('../components/modal.js');
  const { doc, setDoc, serverTimestamp } = await import('firebase/firestore');
  const { ref, uploadBytes, getDownloadURL } = await import('firebase/storage');
  const { storage } = await import('../firebase.js');

  const modalEl = document.createElement('div');
  modalEl.style.cssText = 'padding: 24px; background: var(--color-bg); height: 100%; display: flex; flex-direction: column; gap: 16px; overflow-y: auto;';
  
  modalEl.innerHTML = `
    <div style="text-align: center; display: flex; flex-direction: column; align-items: center; gap: 8px; margin-bottom: 8px;">
      <div style="width: 52px; height: 52px; background: rgba(var(--color-primary-rgb), 0.1); color: var(--color-primary); border-radius: 16px; display: flex; align-items: center; justify-content: center; box-shadow: var(--shadow-sm);">
        ${icon('bike', 32)}
      </div>
      <h3 style="font-family: var(--font-display); font-size: 19px; font-weight: 900; color: var(--color-text-primary); margin: 0;">Postulación de Repartidor</h3>
      <p style="font-size: 12.5px; color: var(--color-text-secondary); margin: 0; line-height: 1.4; max-width: 280px;">
        Completá este formulario profesional para formar parte de la flota oficial de GoDelivery.
      </p>
    </div>

    <form id="delivery-app-form" style="display: flex; flex-direction: column; gap: 14px; padding-bottom: 20px;">
      
      <!-- Full Name -->
      <div style="display: flex; flex-direction: column; gap: 6px;">
        <label style="font-size: 11px; font-weight: 900; color: var(--color-text-secondary); text-transform: uppercase; letter-spacing: 0.5px;">Nombre Completo *</label>
        <input type="text" id="app-fullname" required placeholder="Ej: Juan Pérez" value="${user.displayName || ''}" style="width: 100%; height: 48px; border-radius: 12px; border: 1.5px solid var(--color-border-light); padding: 0 14px; background: var(--color-bg-card); font-size: 13.5px; font-weight: 600; outline: none; transition: border-color 0.2s;" />
      </div>

      <!-- Phone -->
      <div style="display: flex; flex-direction: column; gap: 6px;">
        <label style="font-size: 11px; font-weight: 900; color: var(--color-text-secondary); text-transform: uppercase; letter-spacing: 0.5px;">Teléfono de Contacto *</label>
        <input type="tel" id="app-phone" required placeholder="Ej: 2215551234" value="${user.phone || ''}" style="width: 100%; height: 48px; border-radius: 12px; border: 1.5px solid var(--color-border-light); padding: 0 14px; background: var(--color-bg-card); font-size: 13.5px; font-weight: 600; outline: none; transition: border-color 0.2s;" />
      </div>

      <!-- Vehicle -->
      <div style="display: flex; flex-direction: column; gap: 6px;">
        <label style="font-size: 11px; font-weight: 900; color: var(--color-text-secondary); text-transform: uppercase; letter-spacing: 0.5px;">Vehículo *</label>
        <select id="app-vehicle" required style="width: 100%; height: 48px; border-radius: 12px; border: 1.5px solid var(--color-border-light); padding: 0 14px; background: var(--color-bg-card); font-size: 13.5px; font-weight: 600; outline: none; transition: border-color 0.2s; color: var(--color-text-primary); font-family: inherit;">
          <option value="" disabled selected>Seleccioná tu vehículo</option>
          <option value="Moto">Moto</option>
          <option value="Bicicleta">Bicicleta</option>
          <option value="Auto">Auto</option>
        </select>
      </div>

      <!-- Vehicle Model -->
      <div style="display: flex; flex-direction: column; gap: 6px;">
        <label style="font-size: 11px; font-weight: 900; color: var(--color-text-secondary); text-transform: uppercase; letter-spacing: 0.5px;">Modelo del Vehículo *</label>
        <input type="text" id="app-vehiclemodel" required placeholder="Ej: Honda Wave 110cc / Bicicleta Zenith" style="width: 100%; height: 48px; border-radius: 12px; border: 1.5px solid var(--color-border-light); padding: 0 14px; background: var(--color-bg-card); font-size: 13.5px; font-weight: 600; outline: none; transition: border-color 0.2s;" />
      </div>

      <!-- Vehicle Plate -->
      <div style="display: flex; flex-direction: column; gap: 6px;">
        <label style="font-size: 11px; font-weight: 900; color: var(--color-text-secondary); text-transform: uppercase; letter-spacing: 0.5px;">Patente *</label>
        <input type="text" id="app-vehicledetails" required placeholder="Ej: A123BCD / 'No aplica' para Bicicletas" style="width: 100%; height: 48px; border-radius: 12px; border: 1.5px solid var(--color-border-light); padding: 0 14px; background: var(--color-bg-card); font-size: 13.5px; font-weight: 600; outline: none; transition: border-color 0.2s;" />
      </div>

      <!-- Optional CV Link -->
      <div style="display: flex; flex-direction: column; gap: 6px;">
        <label style="font-size: 11px; font-weight: 900; color: var(--color-text-secondary); text-transform: uppercase; letter-spacing: 0.5px;">Enlace a tu CV (Opcional)</label>
        <input type="url" id="app-cv-link" placeholder="Ej: https://drive.google.com/..." style="width: 100%; height: 48px; border-radius: 12px; border: 1.5px solid var(--color-border-light); padding: 0 14px; background: var(--color-bg-card); font-size: 13.5px; font-weight: 600; outline: none; transition: border-color 0.2s;" />
      </div>

      <!-- Optional CV File Upload -->
      <div style="display: flex; flex-direction: column; gap: 6px;">
        <label style="font-size: 11px; font-weight: 900; color: var(--color-text-secondary); text-transform: uppercase; letter-spacing: 0.5px;">O subir CV (Foto o PDF - Opcional)</label>
        <input type="file" id="app-cv-file" accept=".pdf,image/*" style="display:none;" />
        <button type="button" id="cv-file-btn" class="btn btn-outline" style="height:46px; display:flex; align-items:center; justify-content:center; gap:8px; font-size:13px; font-weight:700; border-radius:12px; cursor:pointer; background:var(--color-bg-card); border:1.5px solid var(--color-border-light); color:var(--color-text-primary);">
          ${icon('uploadCloud', 16)} <span id="cv-file-label">Seleccionar archivo...</span>
        </button>
      </div>

      <!-- Required Driver License Upload -->
      <div style="display: flex; flex-direction: column; gap: 6px;">
        <label style="font-size: 11px; font-weight: 900; color: var(--color-text-secondary); text-transform: uppercase; letter-spacing: 0.5px;">Foto de Licencia de Conducir *</label>
        <input type="file" id="app-licencia-file" accept="image/*" style="display:none;" required />
        <button type="button" id="licencia-file-btn" class="btn btn-outline" style="height:46px; display:flex; align-items:center; justify-content:center; gap:8px; font-size:13px; font-weight:700; border-radius:12px; cursor:pointer; background:var(--color-bg-card); border:1.5px solid var(--color-primary-light); color:var(--color-text-primary);">
          ${icon('camera', 16)} <span id="licencia-file-label">Subir foto de Licencia...</span>
        </button>
      </div>

      <!-- Required Vehicle Insurance Upload -->
      <div style="display: flex; flex-direction: column; gap: 6px;">
        <label style="font-size: 11px; font-weight: 900; color: var(--color-text-secondary); text-transform: uppercase; letter-spacing: 0.5px;">Foto de Seguro del Vehículo *</label>
        <input type="file" id="app-seguro-file" accept="image/*" style="display:none;" required />
        <button type="button" id="seguro-file-btn" class="btn btn-outline" style="height:46px; display:flex; align-items:center; justify-content:center; gap:8px; font-size:13px; font-weight:700; border-radius:12px; cursor:pointer; background:var(--color-bg-card); border:1.5px solid var(--color-primary-light); color:var(--color-text-primary);">
          ${icon('camera', 16)} <span id="seguro-file-label">Subir foto de Seguro...</span>
        </button>
      </div>

      <!-- Submit button -->
      <button type="submit" id="submit-app-btn" class="btn btn-primary" style="width: 100%; height: 50px; border-radius: 14px; background: var(--color-primary); color: white; border: none; font-weight: 900; font-size: 14.5px; cursor: pointer; box-shadow: 0 8px 24px rgba(var(--color-primary-rgb), 0.25); text-transform: uppercase; letter-spacing: 0.05em; display: flex; align-items: center; justify-content: center; gap: 8px; margin-top: 10px;">
        ${icon('check', 18)} Enviar Postulación
      </button>
    </form>
  `;

  showModal({ title: '', content: modalEl, height: '80dvh', hideHeader: true });

  // Input elements
  const cvFileInput = modalEl.querySelector('#app-cv-file');
  const cvBtn = modalEl.querySelector('#cv-file-btn');
  const cvLabel = modalEl.querySelector('#cv-file-label');
  
  const licenciaFileInput = modalEl.querySelector('#app-licencia-file');
  const licenciaBtn = modalEl.querySelector('#licencia-file-btn');
  const licenciaLabel = modalEl.querySelector('#licencia-file-label');

  const seguroFileInput = modalEl.querySelector('#app-seguro-file');
  const seguroBtn = modalEl.querySelector('#seguro-file-btn');
  const seguroLabel = modalEl.querySelector('#seguro-file-label');

  // Trigger clicks
  cvBtn.onclick = () => cvFileInput.click();
  licenciaBtn.onclick = () => licenciaFileInput.click();
  seguroBtn.onclick = () => seguroFileInput.click();

  // Name display logic
  cvFileInput.onchange = () => {
    if (cvFileInput.files.length > 0) {
      cvLabel.textContent = cvFileInput.files[0].name;
      cvBtn.style.borderColor = '#22c55e';
    }
  };

  licenciaFileInput.onchange = () => {
    if (licenciaFileInput.files.length > 0) {
      licenciaLabel.textContent = licenciaFileInput.files[0].name;
      licenciaBtn.style.borderColor = '#22c55e';
    }
  };

  seguroFileInput.onchange = () => {
    if (seguroFileInput.files.length > 0) {
      seguroLabel.textContent = seguroFileInput.files[0].name;
      seguroBtn.style.borderColor = '#22c55e';
    }
  };

  const form = modalEl.querySelector('#delivery-app-form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    
    const fullName = modalEl.querySelector('#app-fullname').value.trim();
    const phone = modalEl.querySelector('#app-phone').value.trim();
    const vehicleType = modalEl.querySelector('#app-vehicle').value;
    const vehicleModel = modalEl.querySelector('#app-vehiclemodel').value.trim();
    const vehicleDetails = modalEl.querySelector('#app-vehicledetails').value.trim();
    const cvLink = modalEl.querySelector('#app-cv-link').value.trim();

    if (!fullName || !phone || !vehicleType || !vehicleModel || !vehicleDetails) {
      showToast('Por favor, completa todos los campos requeridos.', 'warning');
      return;
    }

    if (licenciaFileInput.files.length === 0) {
      showToast('Por favor, subí la foto de tu licencia de conducir.', 'warning');
      return;
    }

    if (seguroFileInput.files.length === 0) {
      showToast('Por favor, subí la foto del seguro de tu vehículo.', 'warning');
      return;
    }

    const submitBtn = modalEl.querySelector('#submit-app-btn');
    submitBtn.disabled = true;
    submitBtn.style.opacity = '0.7';
    submitBtn.innerHTML = `<div class="spinner-mini" style="width:16px; height:16px; border-width:2px; border-top-color:#fff; margin:0;"></div> Subiendo archivos...`;

    try {
      const uploadPromises = [];

      // 1. CV Upload (Optional)
      let cvFileUrl = '';
      if (cvFileInput.files.length > 0) {
        const file = cvFileInput.files[0];
        const fileRef = ref(storage, `delivery_applications/${user.uid}/cv_${Date.now()}_${file.name}`);
        uploadPromises.push(uploadBytes(fileRef, file).then(async (snap) => {
          cvFileUrl = await getDownloadURL(snap.ref);
        }));
      }

      // 2. License Upload (Required)
      let licenciaUrl = '';
      const licenciaFile = licenciaFileInput.files[0];
      const licenciaRef = ref(storage, `delivery_applications/${user.uid}/licencia_${Date.now()}_${licenciaFile.name}`);
      uploadPromises.push(uploadBytes(licenciaRef, licenciaFile).then(async (snap) => {
        licenciaUrl = await getDownloadURL(snap.ref);
      }));

      // 3. Insurance Upload (Required)
      let seguroUrl = '';
      const seguroFile = seguroFileInput.files[0];
      const seguroRef = ref(storage, `delivery_applications/${user.uid}/seguro_${Date.now()}_${seguroFile.name}`);
      uploadPromises.push(uploadBytes(seguroRef, seguroFile).then(async (snap) => {
        seguroUrl = await getDownloadURL(snap.ref);
      }));

      // Wait for all uploads to complete
      await Promise.all(uploadPromises);

      const applicationData = {
        userId: user.uid,
        fullName,
        phone,
        vehicleType,
        vehicleModel,
        vehicleDetails,
        cvLink: cvLink || '',
        cvFileUrl,
        licenciaUrl,
        seguroUrl,
        status: 'pending',
        appliedAt: serverTimestamp()
      };

      // 1. Save in global applications collection
      await setDoc(doc(db, 'delivery_applications', user.uid), applicationData);

      // 2. Update user profile document with pending status
      await setDoc(doc(db, 'users', user.uid), {
        deliveryStatus: 'pending',
        deliveryApplication: applicationData,
        phone: phone // Sync phone to profile
      }, { merge: true });

      showToast('¡Postulación enviada correctamente! Revisaremos tus documentos a la brevedad.', 'success');
      closeModal();
    } catch (err) {
      console.error('Error saving delivery application:', err);
      showToast('Error al enviar postulación: ' + err.message, 'error');
      submitBtn.disabled = false;
      submitBtn.style.opacity = '1';
      submitBtn.innerHTML = `${icon('check', 18)} Enviar Postulación`;
    }
  };
}

async function showHelpAndTermsModal() {
  const { showModal } = await import('../components/modal.js');
  
  showModal({
    title: 'Soporte y Términos',
    height: '85dvh',
    content: `
      <div style="padding: 16px 20px; color: var(--color-text-primary); font-family: var(--font-body); display: flex; flex-direction: column; height: 100%; overflow: hidden;">
        
        <!-- Pestañas (Tabs Selector) -->
        <div class="tab-container">
          <button class="tab-btn active" id="tab-btn-help">
            ${icon('info', 15)} Ayuda y Guía
          </button>
          <button class="tab-btn" id="tab-btn-terms">
            ${icon('shieldCheck', 15)} Términos Legales
          </button>
        </div>

        <!-- Scrollable Content Wrapper -->
        <div style="flex: 1; overflow-y: auto; -webkit-overflow-scrolling: touch; padding-right: 4px; display: flex; flex-direction: column;" id="help-modal-scrollable">
          
          <!-- Contenido: Ayuda y Guía -->
          <div class="tab-content active" id="tab-content-help" style="flex: 1;">
            
            <h4 style="font-family: var(--font-display); font-size: 16px; font-weight: 900; color: var(--color-text-primary); margin: 0 0 12px 0;">Preguntas Frecuentes</h4>
            
            <div class="help-accordion">
              <div class="help-accordion-title">
                <span>🤔 ¿Cómo realizo un pedido?</span>
                <span class="help-accordion-icon">${icon('chevronDown', 14)}</span>
              </div>
              <div class="help-accordion-content">
                ¡Es súper fácil! Primero seleccioná tu categoría favorita (Restaurantes, Supermercado, GoMarket). Buscá el comercio que más te guste, agregá tus productos al carrito, definí tu dirección de entrega en el mapa, seleccioná tu método de pago y confirmá tu orden. ¡Y listo! Podrás seguir al repartidor en vivo.
              </div>
            </div>

            <div class="help-accordion">
              <div class="help-accordion-title">
                <span>💳 ¿Qué medios de pago puedo usar?</span>
                <span class="help-accordion-icon">${icon('chevronDown', 14)}</span>
              </div>
              <div class="help-accordion-content">
                Aceptamos pagos en <strong>Efectivo</strong> directamente al repartidor al recibir tu pedido, o mediante <strong>Transferencia Directa</strong> (vía Alias o CBU) al repartidor o al comercio al momento de la entrega. También podés descontar saldo utilizando tus <strong>GO Points</strong> acumulados. GoDelivery no procesa cobros ni retiene tu dinero, garantizando transacciones 100% directas entre las partes.
              </div>
            </div>

            <div class="help-accordion">
              <div class="help-accordion-title">
                <span>⭐ ¿Qué son y cómo funcionan los GO Points?</span>
                <span class="help-accordion-icon">${icon('chevronDown', 14)}</span>
              </div>
              <div class="help-accordion-content">
                ¡GO Points es nuestro Club de Beneficios! Con cada pedido sumás automáticamente puntos en base al monto gastado y tu nivel. Cada punto equivale a dinero real de descuento. Podés canjear tus puntos en la pantalla del carrito para pagar menos. ¡Y lo mejor es que el descuento es 100% compensado por GO Delivery, por lo que el repartidor no pierde ni un centavo!
              </div>
            </div>

            <div class="help-accordion">
              <div class="help-accordion-title">
                <span>🌦️ ¿Por qué hay un cargo extra por lluvia?</span>
                <span class="help-accordion-icon">${icon('chevronDown', 14)}</span>
              </div>
              <div class="help-accordion-content">
                Cuando llueve, las calles se vuelven peligrosas y resbaladizas. Para incentivar y compensar el esfuerzo extra de nuestros repartidores bajo el agua, el sistema suma un pequeño recargo por clima adverso. <strong>Este plus va 100% al bolsillo del repartidor</strong> como reconocimiento por su labor.
              </div>
            </div>

            <div class="help-accordion">
              <div class="help-accordion-title">
                <span>📞 ¿Cómo me contacto con soporte?</span>
                <span class="help-accordion-icon">${icon('chevronDown', 14)}</span>
              </div>
              <div class="help-accordion-content">
                Si tenés un problema con un pedido activo, podés chatear directamente con el repartidor o con el local desde la pantalla de seguimiento. Para consultas generales, podés escribirnos al canal oficial de soporte de GoDelivery a través de WhatsApp o enviarnos un correo electrónico a soporte@godelivery.com.
              </div>
            </div>

          </div>

          <!-- Contenido: Términos Legales -->
          <div class="tab-content" id="tab-content-terms" style="font-size: 12.5px; line-height: 1.6; color: var(--color-text-secondary); text-align: left; padding-bottom: 24px;">
            
            <p style="margin-top: 0; font-weight: 800; color: var(--color-text-primary);">Términos de Uso y Políticas del Servicio — GoDelivery</p>
            <p style="font-size: 11px; color: var(--color-text-tertiary); margin-top: -8px; margin-bottom: 16px;">Última actualización: Mayo 2026</p>

            <h5 style="font-size: 13px; font-weight: 800; color: var(--color-text-primary); margin: 16px 0 6px 0;">1. Relación Contractual</h5>
            <p style="margin: 0 0 10px 0;">
              GoDelivery actúa de manera exclusiva como un canal de intermediación tecnológica digital entre Comercios Adheridos, Consumidores Finales y Repartidores Independientes de mensajería urbana. Al registrarte y utilizar nuestra plataforma, reconocés y aceptás que GoDelivery no elabora los alimentos, no provee servicios de logística directa y no es empleador de los repartidores independientes.
            </p>

            <h5 style="font-size: 13px; font-weight: 800; color: var(--color-text-primary); margin: 16px 0 6px 0;">2. Geolocalización y Notificaciones Obligatorias</h5>
            <p style="margin: 0 0 10px 0;">
              Para el correcto desempeño de la plataforma (cálculo automatizado de costos de entrega por el algoritmo de Haversine y optimización de repartidores asignados), GoDelivery solicita acceso mandatorio a la <strong>Geolocalización en tiempo real</strong> del dispositivo. Asimismo, para asegurar la comunicación fluida sobre el estado de las órdenes y chat en vivo, el usuario otorga su expreso consentimiento para recibir <strong>Notificaciones Push</strong> en su navegador/celular. Bloquear estas tecnologías puede limitar total o parcialmente el uso de la plataforma.
            </p>

            <h5 style="font-size: 13px; font-weight: 800; color: var(--color-text-primary); margin: 16px 0 6px 0;">3. Pagos y Transferencias entre Partes</h5>
            <p style="margin: 0 0 10px 0;">
              GoDelivery no actúa como pasarela de pagos online ni procesador de cobros. Todos los pagos y transacciones se realizan de manera directa, inmediata y descentralizada entre el Consumidor y el Repartidor/Comercio, ya sea en efectivo físico o mediante transferencias electrónicas bancarias directas (CBU, CVU o Alias). GoDelivery no almacena credenciales financieras, cuentas bancarias ni retiene dinero de las partes. El uso de GO Points se rige bajo la política de fidelización oficial, siendo canjeables exclusivamente dentro de la aplicación.
            </p>

            <h5 style="font-size: 13px; font-weight: 800; color: var(--color-text-primary); margin: 16px 0 6px 0;">4. Limitación de Responsabilidad</h5>
            <p style="margin: 0 0 10px 0;">
              GoDelivery deslinda responsabilidad legal por retrasos climatológicos severos, accidentes viales durante el envío, la calidad organoléptica de los productos suministrados por los locales comerciales, o inconvenientes y errores en las transferencias bancarias directas realizadas entre las partes. Nos comprometemos, sin embargo, a mediar activamente a través de nuestro soporte técnico para ayudar a resolver cualquier disputa de forma rápida, transparente y neutral.
            </p>

            <p style="margin-top: 24px; font-size: 11px; color: var(--color-text-tertiary); text-align: center; font-weight: 750;">
              Al utilizar GoDelivery confirmás tu aceptación a la totalidad de estos términos. ¡Gracias por confiar en nosotros!
            </p>

          </div>

        </div>

        <button class="btn btn-primary btn-block" id="btn-close-help-modal" style="height: 48px; border-radius: 14px; font-size: 13px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.5px; border: none; margin-top: 12px; flex-shrink: 0;">
          Entendido
        </button>

      </div>
    `,
    onOpen: () => {
      const modalWrapper = document.querySelector('.modal-stack-wrapper');
      if (!modalWrapper) return;

      // Handle Tabs selection
      const tabBtnHelp = modalWrapper.querySelector('#tab-btn-help');
      const tabBtnTerms = modalWrapper.querySelector('#tab-btn-terms');
      const tabContentHelp = modalWrapper.querySelector('#tab-content-help');
      const tabContentTerms = modalWrapper.querySelector('#tab-content-terms');

      if (tabBtnHelp && tabBtnTerms && tabContentHelp && tabContentTerms) {
        tabBtnHelp.onclick = () => {
          tabBtnHelp.classList.add('active');
          tabBtnTerms.classList.remove('active');
          tabContentHelp.classList.add('active');
          tabContentTerms.classList.remove('active');
        };

        tabBtnTerms.onclick = () => {
          tabBtnTerms.classList.add('active');
          tabBtnHelp.classList.remove('active');
          tabContentTerms.classList.add('active');
          tabContentHelp.classList.remove('active');
        };
      }

      // Handle Accordion items
      const accordions = modalWrapper.querySelectorAll('.help-accordion');
      accordions.forEach(acc => {
        const title = acc.querySelector('.help-accordion-title');
        if (title) {
          title.onclick = () => {
            const isOpen = acc.classList.contains('open');
            // Close all others
            accordions.forEach(item => item.classList.remove('open'));
            // Toggle current
            if (!isOpen) acc.classList.add('open');
          };
        }
      });

      // Handle Bottom Close Button
      const btnCloseHelp = modalWrapper.querySelector('#btn-close-help-modal');
      if (btnCloseHelp) {
        btnCloseHelp.onclick = () => {
          const closeBtn = modalWrapper.querySelector('.modal-close');
          if (closeBtn) closeBtn.click();
        };
      }
    }
  });
}

async function loadAndRenderModalChallenges(uid) {
  const container = document.getElementById('modal-challenges-container');
  if (!container) return;

  try {
    const { collection, getDocs, setDoc, doc } = await import('firebase/firestore');
    const collRef = collection(db, 'users', uid, 'challenges');
    const snap = await getDocs(collRef);
    let challenges = [];

    if (!snap.empty) {
      challenges = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } else {
      // Create defaults from getState().weeklyChallenges
      const { getState } = await import('../state.js');
      const configuredChallenges = getState().weeklyChallenges || [
        { id: 'weekly_3', title: 'Desafío Bronce', description: 'Completá 3 pedidos esta semana', target: 3, pointsReward: 150 },
        { id: 'weekly_5', title: 'Desafío Plata', description: 'Completá 5 pedidos esta semana', target: 5, pointsReward: 300 },
        { id: 'weekly_10', title: 'Desafío Oro', description: 'Completá 10 pedidos esta semana', target: 10, pointsReward: 600 }
      ];
      challenges = configuredChallenges.map(ch => ({
        id: ch.id,
        title: ch.title,
        description: ch.description || `Completá ${ch.target} pedidos esta semana`,
        target: Number(ch.target),
        progress: 0,
        pointsReward: Number(ch.pointsReward),
        completed: false
      }));
      for (const challenge of challenges) {
        await setDoc(doc(db, 'users', uid, 'challenges', challenge.id), challenge);
      }
    }

    // Sort challenges by target
    challenges.sort((a, b) => a.target - b.target);

    const challengesHtml = challenges.map(ch => {
      const percentage = Math.min(100, Math.max(0, ((ch.progress || 0) / ch.target) * 100));
      return `
        <div style="background: var(--color-bg-secondary); border: 1.5px solid ${ch.completed ? 'var(--color-success)' : 'var(--color-border-light)'}; border-radius: 16px; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
            <div>
              <div style="font-size: 13px; font-weight: 900; color: var(--color-text-primary); display: flex; align-items: center; gap: 6px;">
                ${ch.title}
                ${ch.completed ? `<span style="background: var(--color-success); color: white; font-size: 8px; font-weight: 900; padding: 1.5px 5px; border-radius: 4px; text-transform: uppercase;">¡Hecho!</span>` : ''}
              </div>
              <div style="font-size: 11px; color: var(--color-text-secondary); margin-top: 1px;">
                ${ch.description}
              </div>
            </div>
            <div style="text-align: right; flex-shrink: 0;">
              <span style="font-size: 11px; font-weight: 900; color: #f59e0b; background: rgba(245, 158, 11, 0.1); padding: 2px 6px; border-radius: 6px; display: inline-flex; align-items: center; gap: 3px;">
                +${ch.pointsReward} pts
              </span>
            </div>
          </div>

          <div style="display: flex; align-items: center; gap: 10px; margin-top: 2px;">
            <div style="flex: 1; height: 6px; background: var(--color-border-light); border-radius: 3px; overflow: hidden; position: relative;">
              <div style="width: ${percentage}%; height: 100%; background: ${ch.completed ? 'var(--color-success)' : 'linear-gradient(90deg, #3b82f6 0%, #2563eb 100%)'}; border-radius: 3px; transition: width 0.8s cubic-bezier(0.34, 1.56, 0.64, 1);"></div>
            </div>
            <span style="font-size: 11px; font-weight: 800; color: var(--color-text-secondary); white-space: nowrap;">
              ${ch.progress || 0} / ${ch.target}
            </span>
          </div>
        </div>
      `;
    }).join('');

    container.innerHTML = `
      <div style="font-size: 11px; font-weight: 900; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px;">
        Desafíos de la Semana
      </div>
      <div style="display: flex; flex-direction: column; gap: 8px;">
        ${challengesHtml}
      </div>
    `;
  } catch (error) {
    console.error('Error loading challenges:', error);
    container.innerHTML = `
      <div style="font-size: 11px; font-weight: 900; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px;">
        Desafíos de la Semana
      </div>
      <div style="font-size: 12px; color: var(--color-danger); text-align: center; padding: 10px;">
        Error al cargar los desafíos.
      </div>
    `;
  }
}

async function showTransferGoPointsModal(currentUser) {
  const { showModal, closeModal } = await import('../components/modal.js');
  const { showToast } = await import('../components/toast.js');
  const { doc, getDoc, collection, query, where, getDocs, runTransaction } = await import('firebase/firestore');

  const modalUid = Math.random().toString(36).substr(2, 5);

  const modalContent = `
    <div style="padding: 24px 20px; color: var(--color-text-primary); font-family: var(--font-body); display: flex; flex-direction: column; gap: 16px;">
      <div style="text-align: center; display: flex; flex-direction: column; align-items: center; gap: 8px; margin-bottom: 8px;">
        <div style="width: 52px; height: 52px; border-radius: 16px; background: rgba(16, 185, 129, 0.1); color: #10b981; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.15);">
          ${icon('share', 28)}
        </div>
        <h3 style="font-family: var(--font-display); font-size: 19px; font-weight: 900; margin: 0; letter-spacing: -0.5px;">Transferir GO Points</h3>
        <p style="font-size: 12px; color: var(--color-text-secondary); margin: 0; line-height: 1.4; max-width: 260px;">
          Regalale tus puntos acumulados a otro usuario para que pueda usarlos en su próxima compra.
        </p>
      </div>

      <div style="background: var(--color-bg-secondary); border-radius: 16px; padding: 12px 14px; display: flex; justify-content: space-between; align-items: center; border: 1px solid var(--color-border-light);">
        <div>
          <span style="font-size: 10px; font-weight: 800; color: var(--color-text-tertiary); text-transform: uppercase;">Tu saldo disponible</span>
          <div style="font-size: 16px; font-weight: 900; color: #f59e0b; display: flex; align-items: center; gap: 4px; margin-top: 1px;">
            ${icon('goPointsLogo', 14)} <span id="sender-points-display-${modalUid}">${currentUser.points || 0}</span> pts
          </div>
        </div>
        <div style="text-align: right;">
          <span style="font-size: 10px; font-weight: 800; color: var(--color-text-tertiary); text-transform: uppercase;">Tu ID de Usuario</span>
          <div style="font-size: 15px; font-weight: 900; color: var(--color-text-primary); margin-top: 1px; font-family: monospace; letter-spacing: 0.5px;">
            ${currentUser.goId || '---'}
          </div>
        </div>
      </div>

      <div style="display: flex; flex-direction: column; gap: 12px; margin-top: 4px;">
        <div>
          <label style="font-size: 10.5px; font-weight: 800; color: var(--color-text-tertiary); text-transform: uppercase; display: block; margin-bottom: 6px; letter-spacing: 0.3px;">ID del Destinatario (ej. GO-1005)</label>
          <input type="text" id="transfer-target-id-${modalUid}" placeholder="GO-XXXX" style="width: 100%; height: 48px; border-radius: 12px; border: 1.5px solid var(--color-border); padding: 0 14px; font-weight: 700; font-size: 14px; font-family: monospace; text-transform: uppercase; background: var(--color-surface); color: var(--color-text); outline: none; transition: border-color 0.2s;" onfocus="this.style.borderColor='var(--color-primary)'" onblur="this.style.borderColor='var(--color-border)'" />
        </div>
        <div>
          <label style="font-size: 10.5px; font-weight: 800; color: var(--color-text-tertiary); text-transform: uppercase; display: block; margin-bottom: 6px; letter-spacing: 0.3px;">Cantidad a Enviar</label>
          <input type="number" id="transfer-amount-${modalUid}" placeholder="Monto de puntos" min="1" step="1" style="width: 100%; height: 48px; border-radius: 12px; border: 1.5px solid var(--color-border); padding: 0 14px; font-weight: 700; font-size: 14px; background: var(--color-surface); color: var(--color-text); outline: none; transition: border-color 0.2s;" onfocus="this.style.borderColor='var(--color-primary)'" onblur="this.style.borderColor='var(--color-border)'" />
        </div>
      </div>

      <button id="btn-execute-transfer-${modalUid}" class="btn btn-primary btn-block" style="height: 48px; border-radius: 14px; font-size: 13px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.5px; border: none; margin-top: 10px; display: flex; align-items: center; justify-content: center; gap: 8px;">
        ${icon('check', 16)} Confirmar Transferencia
      </button>
    </div>
  `;

  showModal({
    title: 'Regalar GO Points',
    height: 'auto',
    content: modalContent,
    onOpen: () => {
      const execBtn = document.getElementById(`btn-execute-transfer-${modalUid}`);
      execBtn?.addEventListener('click', async () => {
        const targetIdInput = document.getElementById(`transfer-target-id-${modalUid}`);
        const amountInput = document.getElementById(`transfer-amount-${modalUid}`);

        const rawTargetId = targetIdInput.value.trim().toUpperCase();
        const amount = parseInt(amountInput.value);

        if (!rawTargetId) {
          showToast('Por favor, ingresá el ID del destinatario', 'warning');
          return;
        }

        if (rawTargetId === currentUser.goId) {
          showToast('No podés enviarte puntos a vos mismo', 'warning');
          return;
        }

        if (isNaN(amount) || amount <= 0) {
          showToast('Ingresá una cantidad válida mayor a cero', 'warning');
          return;
        }

        const senderCurrentPoints = currentUser.points || 0;
        if (amount > senderCurrentPoints) {
          showToast('Saldo insuficiente de GO Points', 'error');
          return;
        }

        execBtn.disabled = true;
        execBtn.innerHTML = `<div class="spinner-mini" style="width:14px; height:14px; border-width:2px; border-top-color:white; margin:0;"></div> Procesando...`;

        try {
          // 1. Query recipient user document with matching goId
          const usersRef = collection(db, 'users');
          const q = query(usersRef, where('goId', '==', rawTargetId));
          const recipientSnap = await getDocs(q);

          if (recipientSnap.empty) {
            showToast(`No se encontró ningún usuario con el ID ${rawTargetId}`, 'error');
            execBtn.disabled = false;
            execBtn.innerHTML = `${icon('check', 16)} Confirmar Transferencia`;
            return;
          }

          const recipientDoc = recipientSnap.docs[0];
          const recipientUid = recipientDoc.id;
          const recipientData = recipientDoc.data();

          // 2. Perform Transaction to ensure safety and atomic update
          await runTransaction(db, async (transaction) => {
            const senderDocRef = doc(db, 'users', currentUser.uid);
            const recipientDocRef = doc(db, 'users', recipientUid);

            const senderFreshSnap = await transaction.get(senderDocRef);
            if (!senderFreshSnap.exists()) throw new Error('Sender user does not exist');
            
            const senderFreshPoints = senderFreshSnap.data().points || 0;
            if (amount > senderFreshPoints) {
              throw new Error('Saldo insuficiente detectado en la transacción');
            }

            // Deduct from sender
            transaction.update(senderDocRef, {
              points: senderFreshPoints - amount
            });

            // Add to recipient
            const recipientFreshPoints = recipientData.points || 0;
            transaction.update(recipientDocRef, {
              points: recipientFreshPoints + amount
            });

            // Log point transaction for sender
            const senderTransRef = doc(collection(db, 'points_transactions'));
            transaction.set(senderTransRef, {
              userId: currentUser.uid,
              type: 'transfer_sent',
              points: -amount,
              description: `Enviaste puntos a ${recipientData.displayName || 'Usuario'} (${rawTargetId})`,
              createdAt: new Date()
            });

            // Log point transaction for recipient
            const recipientTransRef = doc(collection(db, 'points_transactions'));
            transaction.set(recipientTransRef, {
              userId: recipientUid,
              type: 'transfer_received',
              points: amount,
              description: `Recibiste puntos de ${currentUser.displayName || 'Usuario'} (${currentUser.goId})`,
              createdAt: new Date()
            });
            
            // Log live notification for recipient in their subcollection
            const notificationRef = doc(collection(db, 'users', recipientUid, 'notifications'));
            transaction.set(notificationRef, {
              type: 'points_received',
              title: '🎁 ¡Te regalaron GO Points!',
              body: `${currentUser.displayName || 'Un amigo'} te envió ${amount} GO Points de regalo. ¡Disfrutalos!`,
              status: 'unread',
              url: '#/profile',
              createdAt: new Date()
            });
          });

          showToast(`¡Transferiste ${amount} GO Points con éxito!`, 'success');
          closeModal();
        } catch (error) {
          console.error('Transfer failed:', error);
          showToast(error.message || 'Error al procesar la transferencia', 'error');
          execBtn.disabled = false;
          execBtn.innerHTML = `${icon('check', 16)} Confirmar Transferencia`;
        }
      });
    }
  });
}
