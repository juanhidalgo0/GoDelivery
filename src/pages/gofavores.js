
import { db } from '../firebase.js';
import { collection, addDoc, serverTimestamp, doc, getDoc } from 'firebase/firestore';
import { getState, setState } from '../state.js';
import { formatPrice } from '../utils/format.js';
import { showToast } from '../components/toast.js';
import { icon } from '../utils/icons.js';
import { showModal, closeModal, showConfirm } from '../components/modal.js';
import { isLoggedIn } from '../auth.js';
import { showAddressPrompt } from '../components/address-modal.js';

export async function renderGoFavores(content) {
  if (!content) content = document.getElementById('app-content');
  if (!content) return;

  const user = getState().user;
  if (!user || !isLoggedIn()) {
    content.innerHTML = `<div class="empty-state">Iniciá sesión para usar GoFavores</div>`;
    return;
  }
  
  content.innerHTML = `
    <div class="gofavores-page page-enter" style="display:flex; flex-direction:column; background: linear-gradient(to bottom, var(--color-bg), var(--color-bg-secondary)); width: 100%; box-sizing: border-box; height: 100%; overflow: hidden; position: relative;">
      
      <!-- Ambient Background Blobs (Soft Glows) -->
      <div class="home-blob home-blob-1" style="position: absolute; top: -10%; left: -20%; width: 300px; height: 300px; background: rgba(225, 29, 72, 0.05); border-radius: 50%; filter: blur(80px); pointer-events: none; z-index: 1;"></div>
      <div class="home-blob home-blob-2" style="position: absolute; bottom: 10%; right: -20%; width: 250px; height: 250px; background: rgba(99, 102, 241, 0.05); border-radius: 50%; filter: blur(80px); pointer-events: none; z-index: 1;"></div>

      <!-- Floating Info Helper Button -->
      <button id="gofavores-help-header-btn" style="position: absolute; top: calc(env(safe-area-inset-top, 0px) + 12px); right: 16px; width: 36px; height: 36px; border-radius: 12px; background: rgba(255, 255, 255, 0.15); border: 1px solid rgba(255, 255, 255, 0.25); color: white; display: flex; align-items: center; justify-content: center; cursor: pointer; z-index: 1000; backdrop-filter: blur(5px); -webkit-backdrop-filter: blur(5px); transition: all 0.2s;" onactive="transform: scale(0.95);">
        ${icon('info', 18)}
      </button>

      <div style="padding: calc(var(--header-height, 60px) + 8px) 14px calc(12px + env(safe-area-inset-bottom, 0px)); display: flex; flex-direction: column; gap: 14px; flex: 1; width: 100%; box-sizing: border-box; max-width: 600px; margin: 0 auto; position: relative; z-index: 2; height: 100%;">
        
        <!-- Cards Grouped Together -->
        <div style="display: flex; flex-direction: column; gap: 10px; width: 100%; box-sizing: border-box; flex-shrink: 0;">
          <!-- Option 1: Encomienda -->
          <div id="favor-mandado-btn" class="gofavores-card card-encomienda glow-hover spring-hover" style="border-radius: 16px; padding: 12px 14px; border: 1px solid rgba(255,255,255,0.15); cursor: pointer; display: flex; align-items: center; gap: 12px; width: 100%; box-sizing: border-box; position: relative; box-shadow: 0 4px 20px rgba(0,0,0,0.015); animation: fadeInUp 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) 0.05s both;">
            <!-- Ambient light reflection -->
            <div style="position: absolute; top: -50%; left: -50%; width: 200%; height: 200%; background: radial-gradient(circle, rgba(255,255,255,0.15) 0%, transparent 60%); pointer-events: none;"></div>
            <div class="gofavores-icon-box" style="width: 44px; height: 44px; border-radius: 12px; background: rgba(255, 255, 255, 0.2); color: #ffffff; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 8px rgba(0,0,0,0.06); border: 1px solid rgba(255,255,255,0.15); backdrop-filter: blur(5px); -webkit-backdrop-filter: blur(5px); z-index: 2;">
              ${icon('package', 22)}
            </div>
            <div style="flex: 1; min-width: 0; text-align: left; z-index: 2;">
              <h3 style="font-family: var(--font-display); font-size: 14.5px; font-weight: 900; margin: 0 0 1px; color: #ffffff; letter-spacing: -0.02em; text-shadow: 0 1px 2px rgba(0,0,0,0.1);">Encomienda</h3>
              <p style="font-size: 11px; color: rgba(255, 255, 255, 0.9); line-height: 1.3; margin: 0; font-weight: 600;">Buscamos y llevamos lo que necesites donde nos digas.</p>
              <span style="display: inline-flex; align-items: center; gap: 4px; margin-top: 4px; background: rgba(255, 255, 255, 0.2); padding: 3px 8px; border-radius: 6px; color: #ffffff; font-size: 8.5px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.05em; border: 1px solid rgba(255, 255, 255, 0.25);">
                Costo normal de envío
              </span>
            </div>
            <div style="display: flex; flex-direction: column; gap: 4px; align-items: center; justify-content: center; flex-shrink: 0; z-index: 2;">
              <div id="info-mandado-btn" class="info-btn-favores" style="color: #ffffff; display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 50%; background: rgba(255, 255, 255, 0.2); cursor: pointer; transition: background 0.2s;">
                ${icon('info', 14)}
              </div>
              <div class="chevron-icon-container" style="color: #ffffff; display: flex; align-items: center; background: rgba(255, 255, 255, 0.2); width: 28px; height: 28px; border-radius: 50%; justify-content: center; border: 1px solid rgba(255, 255, 255, 0.25);">
                ${icon('chevronRight', 12)}
              </div>
            </div>
          </div>

          <!-- Option 2: Mandado -->
          <div id="favor-compra-btn" class="gofavores-card card-mandado glow-hover spring-hover" style="border-radius: 16px; padding: 12px 14px; border: 1px solid rgba(255,255,255,0.15); cursor: pointer; display: flex; align-items: center; gap: 12px; width: 100%; box-sizing: border-box; position: relative; box-shadow: 0 4px 20px rgba(0,0,0,0.015); animation: fadeInUp 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) 0.12s both;">
            <!-- Ambient light reflection -->
            <div style="position: absolute; top: -50%; left: -50%; width: 200%; height: 200%; background: radial-gradient(circle, rgba(255,255,255,0.15) 0%, transparent 60%); pointer-events: none;"></div>
            <div class="gofavores-icon-box" style="width: 44px; height: 44px; border-radius: 12px; background: rgba(255, 255, 255, 0.2); color: #ffffff; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 8px rgba(0,0,0,0.06); border: 1px solid rgba(255,255,255,0.15); backdrop-filter: blur(5px); -webkit-backdrop-filter: blur(5px); z-index: 2;">
              ${icon('shoppingBag', 22)}
            </div>
            <div style="flex: 1; min-width: 0; text-align: left; z-index: 2;">
              <h3 style="font-family: var(--font-display); font-size: 14.5px; font-weight: 900; margin: 0 0 1px; color: #ffffff; letter-spacing: -0.02em; text-shadow: 0 1px 2px rgba(0,0,0,0.1);">Mandado</h3>
              <p style="font-size: 11px; color: rgba(255, 255, 255, 0.9); line-height: 1.3; margin: 0; font-weight: 600;">Compramos lo que necesites en cualquier negocio local.</p>
              <span style="display: inline-flex; align-items: center; gap: 4px; margin-top: 4px; background: rgba(255, 255, 255, 0.2); padding: 3px 8px; border-radius: 6px; color: #ffffff; font-size: 8.5px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.05em; border: 1px solid rgba(255, 255, 255, 0.25);">
                Tarifa de gestión
              </span>
            </div>
            <div style="display: flex; flex-direction: column; gap: 4px; align-items: center; justify-content: center; flex-shrink: 0; z-index: 2;">
              <div id="info-compra-btn" class="info-btn-favores" style="color: #ffffff; display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 50%; background: rgba(255, 255, 255, 0.2); cursor: pointer; transition: background 0.2s;">
                ${icon('info', 14)}
              </div>
              <div class="chevron-icon-container" style="color: #ffffff; display: flex; align-items: center; background: rgba(255, 255, 255, 0.2); width: 28px; height: 28px; border-radius: 50%; justify-content: center; border: 1px solid rgba(255, 255, 255, 0.25);">
                ${icon('chevronRight', 12)}
              </div>
            </div>
          </div>

          <!-- Option 3: Go Cash -->
          <div id="favor-gocash-btn" class="gofavores-card card-gocash glow-hover spring-hover" style="border-radius: 16px; padding: 12px 14px; border: 1px solid rgba(255,255,255,0.15); cursor: pointer; display: flex; align-items: center; gap: 12px; width: 100%; box-sizing: border-box; position: relative; box-shadow: 0 4px 20px rgba(0,0,0,0.015); animation: fadeInUp 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) 0.18s both;">
            <!-- Ambient light reflection -->
            <div style="position: absolute; top: -50%; left: -50%; width: 200%; height: 200%; background: radial-gradient(circle, rgba(255,255,255,0.15) 0%, transparent 60%); pointer-events: none;"></div>
            <div class="gofavores-icon-box" style="width: 44px; height: 44px; border-radius: 12px; background: rgba(255, 255, 255, 0.2); color: #ffffff; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 8px rgba(0,0,0,0.06); border: 1px solid rgba(255,255,255,0.15); backdrop-filter: blur(5px); -webkit-backdrop-filter: blur(5px); z-index: 2;">
              ${icon('dollarSign', 22)}
            </div>
            <div style="flex: 1; min-width: 0; text-align: left; z-index: 2;">
              <h3 style="font-family: var(--font-display); font-size: 14.5px; font-weight: 900; margin: 0 0 1px; color: #ffffff; letter-spacing: -0.02em; text-shadow: 0 1px 2px rgba(0,0,0,0.1);">Go Cash</h3>
              <p style="font-size: 11px; color: rgba(255, 255, 255, 0.9); line-height: 1.3; margin: 0; font-weight: 600;">Cambiá efectivo por transferencia o viceversa.</p>
              <span style="display: inline-flex; align-items: center; gap: 4px; margin-top: 4px; background: rgba(255, 255, 255, 0.2); padding: 3px 8px; border-radius: 6px; color: #ffffff; font-size: 8.5px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.05em; border: 1px solid rgba(255, 255, 255, 0.25);">
                Efectivo ↔ Transferencia
              </span>
            </div>
            <div style="display: flex; flex-direction: column; gap: 4px; align-items: center; justify-content: center; flex-shrink: 0; z-index: 2;">
              <div id="info-gocash-btn" class="info-btn-favores" style="color: #ffffff; display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 50%; background: rgba(255, 255, 255, 0.2); cursor: pointer; transition: background 0.2s;">
                ${icon('info', 14)}
              </div>
              <div class="chevron-icon-container" style="color: #ffffff; display: flex; align-items: center; background: rgba(255, 255, 255, 0.2); width: 28px; height: 28px; border-radius: 50%; justify-content: center; border: 1px solid rgba(255, 255, 255, 0.25);">
                ${icon('chevronRight', 12)}
              </div>
            </div>
          </div>

          <!-- Option 4: Pago de Servicios -->
          <div id="favor-pagodeservicios-btn" class="gofavores-card card-pagodeservicios glow-hover spring-hover" style="border-radius: 16px; padding: 12px 14px; border: 1px solid rgba(255,255,255,0.15); cursor: pointer; display: flex; align-items: center; gap: 12px; width: 100%; box-sizing: border-box; position: relative; box-shadow: 0 4px 20px rgba(0,0,0,0.015); animation: fadeInUp 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) 0.2s both;">
            <!-- Ambient light reflection -->
            <div style="position: absolute; top: -50%; left: -50%; width: 200%; height: 200%; background: radial-gradient(circle, rgba(255,255,255,0.15) 0%, transparent 60%); pointer-events: none;"></div>
            <div class="gofavores-icon-box" style="width: 44px; height: 44px; border-radius: 12px; background: rgba(255, 255, 255, 0.2); color: #ffffff; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 8px rgba(0,0,0,0.06); border: 1px solid rgba(255,255,255,0.15); backdrop-filter: blur(5px); -webkit-backdrop-filter: blur(5px); z-index: 2;">
              ${icon('fileText', 22)}
            </div>
            <div style="flex: 1; min-width: 0; text-align: left; z-index: 2;">
              <h3 style="font-family: var(--font-display); font-size: 14.5px; font-weight: 900; margin: 0 0 1px; color: #ffffff; letter-spacing: -0.02em; text-shadow: 0 1px 2px rgba(0,0,0,0.1);">Pago de Servicios</h3>
              <p style="font-size: 11px; color: rgba(255, 255, 255, 0.9); line-height: 1.3; margin: 0; font-weight: 600;">Pagá tus facturas (ABSA, Canal 4, Cyber, etc) a domicilio o digital.</p>
              <span style="display: inline-flex; align-items: center; gap: 4px; margin-top: 4px; background: rgba(255, 255, 255, 0.2); padding: 3px 8px; border-radius: 6px; color: #ffffff; font-size: 8.5px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.05em; border: 1px solid rgba(255, 255, 255, 0.25);">
                Facturas 📄 Trámites
              </span>
            </div>
            <div style="display: flex; flex-direction: column; gap: 4px; align-items: center; justify-content: center; flex-shrink: 0; z-index: 2;">
              <div id="info-pagodeservicios-btn" class="info-btn-favores" style="color: #ffffff; display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 50%; background: rgba(255, 255, 255, 0.2); cursor: pointer; transition: background 0.2s;">
                ${icon('info', 14)}
              </div>
              <div class="chevron-icon-container" style="color: #ffffff; display: flex; align-items: center; background: rgba(255, 255, 255, 0.2); width: 28px; height: 28px; border-radius: 50%; justify-content: center; border: 1px solid rgba(255, 255, 255, 0.25);">
                ${icon('chevronRight', 12)}
              </div>
            </div>
          </div>
        </div>

        <!-- Info Section (Stretches to fill available space) -->
        <div class="gofavores-info-section" style="padding: 14px 16px; border-radius: 16px; border: 1px dashed var(--color-border); width: 100%; box-sizing: border-box; display: flex; flex-direction: column; justify-content: space-between; flex: 1; box-shadow: 0 4px 20px rgba(0,0,0,0.015); animation: fadeInUp 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) 0.24s both; min-height: 0;">
          <div>
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 12px;">
              <div style="width:28px; height:28px; border-radius:6px; background:rgba(var(--color-primary-rgb),0.15); color:var(--color-primary); display:flex; align-items:center; justify-content:center;">
                ${icon('info', 15)}
              </div>
              <h4 style="font-family: var(--font-display); font-size: 14.5px; font-weight: 900; color: var(--color-text-primary); margin: 0;">¿Cómo funciona GoFavores?</h4>
            </div>
            <ul style="margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 12px;">
              <li style="display:flex; gap:10px; align-items: flex-start;">
                 <div style="width:18px; height:18px; border-radius:50%; background:var(--color-primary); color:white; display:flex; align-items:center; justify-content:center; flex-shrink:0; font-size:10px; font-weight:900; margin-top:2px;">1</div>
                 <div style="display: flex; flex-direction: column; text-align: left;">
                   <span style="font-size: 12.5px; color: var(--color-text-primary); font-weight: 800; line-height: 1.2;">Completás el formulario</span>
                   <span style="font-size: 11px; color: var(--color-text-secondary); font-weight: 600; line-height: 1.3; margin-top: 1px;">Ingresá el origen, el destino y las aclaraciones sobre qué requerís.</span>
                 </div>
              </li>
              <li style="display:flex; gap:10px; align-items: flex-start;">
                 <div style="width:18px; height:18px; border-radius:50%; background:var(--color-primary); color:white; display:flex; align-items:center; justify-content:center; flex-shrink:0; font-size:10px; font-weight:900; margin-top:2px;">2</div>
                 <div style="display: flex; flex-direction: column; text-align: left;">
                   <span style="font-size: 12.5px; color: var(--color-text-primary); font-weight: 800; line-height: 1.2;">Contacto y coordinación</span>
                   <span style="font-size: 11px; color: var(--color-text-secondary); font-weight: 600; line-height: 1.3; margin-top: 1px;">El repartidor asignado te escribirá por chat privado ante cualquier duda comercial.</span>
                 </div>
              </li>
              <li style="display:flex; gap:10px; align-items: flex-start;">
                 <div style="width:18px; height:18px; border-radius:50%; background:var(--color-primary); color:white; display:flex; align-items:center; justify-content:center; flex-shrink:0; font-size:10px; font-weight:900; margin-top:2px;">3</div>
                 <div style="display: flex; flex-direction: column; text-align: left;">
                   <span style="font-size: 12.5px; color: var(--color-text-primary); font-weight: 800; line-height: 1.2;">Seguís el recorrido en vivo</span>
                   <span style="font-size: 11px; color: var(--color-text-secondary); font-weight: 600; line-height: 1.3; margin-top: 1px;">Seguí el recorrido en tiempo real sobre el mapa integrado hasta tu puerta.</span>
                 </div>
              </li>
            </ul>
          </div>
          
          <!-- Bottom Security Badge to fill space beautifully -->
          <div style="display: flex; align-items: center; gap: 8px; background: rgba(var(--color-primary-rgb), 0.05); padding: 8px 12px; border-radius: 10px; margin-top: 10px; border: 1px solid rgba(var(--color-primary-rgb), 0.1); justify-content: center;">
            <span style="color: var(--color-primary); display: flex; align-items: center; justify-content: center;">
              ${icon('check', 14)}
            </span>
            <span style="font-size: 10px; font-weight: 700; color: var(--color-text-secondary); text-align: center;">
              Tu solicitud está asegurada y monitoreada por soporte técnico en tiempo real.
            </span>
          </div>
        </div>
      </div>
    </div>
    
    <style>
      .slide-overlay:has(.gofavores-page) {
        overflow: hidden !important;
        overflow-y: hidden !important;
        height: 100% !important;
      }
      .slide-overlay:has(.gofavores-page) #app-content {
        height: 100% !important;
        min-height: 100% !important;
        padding-bottom: 0 !important;
        overflow: hidden !important;
        display: flex !important;
        flex-direction: column !important;
      }
      #app-content:has(.gofavores-page) {
        overflow: hidden !important;
        height: 100% !important;
      }
      #app-content:has(.gofavores-page) ~ #app-navbar,
      body:has(.gofavores-page) #app-navbar,
      body:has(.gofavores-page) .bottom-nav {
        display: none !important;
      }
      
      /* Make layout responsive to smaller screen heights to prevent overflow and clipping */
      @media (max-height: 700px) {
        .gofavores-page > div {
          padding-top: calc(var(--header-height, 60px) + 4px) !important;
          padding-bottom: calc(8px + env(safe-area-inset-bottom, 0px)) !important;
        }
        .gofavores-card {
          padding: 8px 12px !important;
          gap: 10px !important;
        }
        .gofavores-icon-box {
          width: 38px !important;
          height: 38px !important;
        }
        .gofavores-icon-box svg {
          width: 18px !important;
          height: 18px !important;
        }
        .gofavores-card h3 {
          font-size: 13.5px !important;
        }
        .gofavores-card p {
          font-size: 10.5px !important;
        }
        .gofavores-info-section {
          padding: 8px 12px !important;
          gap: 6px !important;
        }
        .gofavores-info-section ul {
          gap: 4px !important;
        }
        .gofavores-info-section li {
          gap: 8px !important;
        }
        .gofavores-info-section li span {
          font-size: 11.5px !important;
        }
        .gofavores-info-section li span + span {
          font-size: 10px !important;
        }
      }

      .gofavores-card {
        will-change: transform, box-shadow;
        color: #ffffff;
        transition: transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275), box-shadow 0.4s ease, border-color 0.3s ease !important;
        position: relative;
        overflow: hidden;
      }
      
      /* Solid Vibrant Colors for Light Theme */
      .card-encomienda {
        background: linear-gradient(135deg, #10B981 0%, #047857 100%) !important;
        border-color: rgba(16, 185, 129, 0.3) !important;
        box-shadow: 0 8px 20px rgba(16, 185, 129, 0.15) !important;
      }
      .card-mandado {
        background: linear-gradient(135deg, #FF2E55 0%, #E10036 100%) !important;
        border-color: rgba(225, 29, 72, 0.3) !important;
        box-shadow: 0 8px 20px rgba(225, 29, 72, 0.15) !important;
      }
      .card-gocash {
        background: linear-gradient(135deg, #6366F1 0%, #4338ca 100%) !important;
        border-color: rgba(99, 102, 241, 0.3) !important;
        box-shadow: 0 8px 20px rgba(99, 102, 241, 0.15) !important;
      }
      .card-pagodeservicios {
        background: linear-gradient(135deg, #F59E0B 0%, #D97706 100%) !important;
        border-color: rgba(245, 158, 11, 0.3) !important;
        box-shadow: 0 8px 20px rgba(245, 158, 11, 0.15) !important;
      }
      .gofavores-info-section {
        background: rgba(255, 255, 255, 0.65) !important;
        border: 1.5px solid rgba(226, 232, 240, 0.8) !important;
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        box-shadow: 0 8px 32px rgba(15, 23, 42, 0.04) !important;
      }

      /* Solid Colors for Dark Theme */
      [data-theme="dark"] .card-encomienda {
        background: linear-gradient(135deg, #064e3b 0%, #047857 100%) !important;
        border-color: rgba(4, 120, 87, 0.3) !important;
        box-shadow: 0 8px 20px rgba(4, 120, 87, 0.25) !important;
      }
      [data-theme="dark"] .card-mandado {
        background: linear-gradient(135deg, #7f1d1d 0%, #E11D48 100%) !important;
        border-color: rgba(225, 29, 72, 0.3) !important;
        box-shadow: 0 8px 20px rgba(225, 29, 72, 0.25) !important;
      }
      [data-theme="dark"] .card-gocash {
        background: linear-gradient(135deg, #312e81 0%, #4338ca 100%) !important;
        border-color: rgba(67, 56, 202, 0.3) !important;
        box-shadow: 0 8px 20px rgba(67, 56, 202, 0.25) !important;
      }
      [data-theme="dark"] .card-pagodeservicios {
        background: linear-gradient(135deg, #78350F 0%, #D97706 100%) !important;
        border-color: rgba(217, 119, 6, 0.3) !important;
        box-shadow: 0 8px 20px rgba(217, 119, 6, 0.25) !important;
      }
      [data-theme="dark"] .gofavores-info-section {
        background: rgba(16, 25, 44, 0.65) !important;
        border: 1.5px solid rgba(255, 255, 255, 0.08) !important;
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2) !important;
      }

      .gofavores-card:hover {
        transform: translateY(-4px) scale(1.01);
        box-shadow: 0 12px 28px rgba(0, 0, 0, 0.15) !important;
      }
      .gofavores-card:hover .gofavores-icon-box {
        transform: scale(1.1) rotate(-8deg);
      }
      .gofavores-card:hover .chevron-icon-container {
        transform: translateX(3px);
      }
      .gofavores-card:active {
        transform: translateY(-1px) scale(0.99);
      }
      .gofavores-icon-box {
        transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      }
      .chevron-icon-container {
        transition: transform 0.25s ease;
      }
      .info-btn-favores:hover {
        background: rgba(255, 255, 255, 0.35) !important;
      }
    </style>
  `;

  const checkPhoneAndOpen = (openFn) => {
    const u = getState().user;
    if (!u.phone || u.phone.trim() === '') {
      showConfirm({
        title: '📱 Teléfono Requerido',
        message: 'Para realizar un favor o mandado es obligatorio configurar un celular de contacto para que el chofer y el soporte se comuniquen.',
        confirmText: 'Configurar ahora',
        cancelText: 'Volver',
        onConfirm: () => {
          sessionStorage.setItem('open-phone-edit', 'true');
          location.hash = '#/profile';
        }
      });
    } else {
      openFn();
    }
  };

  document.getElementById('favor-mandado-btn').onclick = () => checkPhoneAndOpen(showMandadoForm);
  document.getElementById('favor-compra-btn').onclick = () => checkPhoneAndOpen(showCompraForm);
  document.getElementById('favor-gocash-btn').onclick = () => checkPhoneAndOpen(showGoCashForm);
  document.getElementById('favor-pagodeservicios-btn').onclick = () => checkPhoneAndOpen(showPagoServiciosForm);

  document.getElementById('info-mandado-btn').onclick = (e) => {
    e.stopPropagation();
    showServiceInfoModal('encomienda');
  };
  document.getElementById('info-compra-btn').onclick = (e) => {
    e.stopPropagation();
    showServiceInfoModal('mandado');
  };
  document.getElementById('info-gocash-btn').onclick = (e) => {
    e.stopPropagation();
    showServiceInfoModal('gocash');
  };
  document.getElementById('info-pagodeservicios-btn').onclick = (e) => {
    e.stopPropagation();
    showServiceInfoModal('pagodeservicios');
  };

  const helpBtn = document.getElementById('gofavores-help-header-btn');
  if (helpBtn) {
    helpBtn.onclick = () => showGoFavoresGeneralModal();
  }

  const hasSeenInfo = localStorage.getItem('info_seen_gofavores_v4');
  if (!hasSeenInfo) {
    showGoFavoresGeneralModal();
    localStorage.setItem('info_seen_gofavores_v4', 'true');
  }
}

export function showServiceInfoModal(service) {
  let title = '';
  let contentHtml = '';
  
  if (service === 'encomienda') {
    title = '📦 Encomiendas Especiales';
    contentHtml = `
      <div style="padding: 20px; font-family: inherit; color: var(--color-text-primary); line-height: 1.5; font-size: 14px; display: flex; flex-direction: column; gap: 16px;">
        <p style="margin: 0; font-weight: 700;">¿Cómo funciona el servicio?</p>
        <p style="margin: 0; color: var(--color-text-secondary);">El repartidor retira un paquete, documento u objeto desde el punto de origen indicado y lo traslada de forma directa al destino seleccionado en el mapa.</p>
        
        <p style="margin: 0; font-weight: 700; color: var(--color-primary);">Límites y Restricciones:</p>
        <ul style="margin: 0; padding-left: 20px; color: var(--color-text-secondary); display: flex; flex-direction: column; gap: 8px;">
          <li><strong>Medio de transporte:</strong> El paquete debe ser transportable de forma totalmente segura en una motocicleta. Si el repartidor lo considera, puede decidir cancelar la encomienda.</li>
        </ul>
        <button id="modal-entendido-btn" style="margin-top: 10px; width: 100%; height: 48px; border-radius: 12px; border: none; background: var(--color-primary); color: white; font-weight: 800; cursor: pointer; box-shadow: 0 4px 15px rgba(var(--color-primary-rgb), 0.2);">Entendido</button>
      </div>
    `;
  } else if (service === 'mandado') {
    title = '🏪 Mandados y Compras';
    contentHtml = `
      <div style="padding: 20px; font-family: inherit; color: var(--color-text-primary); line-height: 1.5; font-size: 14px; display: flex; flex-direction: column; gap: 16px;">
        <p style="margin: 0; font-weight: 700;">¿Cómo funciona el servicio?</p>
        <p style="margin: 0; color: var(--color-text-secondary);">El repartidor se dirige a los locales comerciales indicados por vos (podés agregar hasta 5 paradas), compra los productos y te los entrega en tu domicilio.</p>
        
        <p style="margin: 0; font-weight: 700; color: var(--color-primary);">Tarifa de Gestión Especial:</p>
        <p style="margin: 0; color: var(--color-text-secondary);">El costo adicional por tarifa de gestión cubre el tiempo que el repartidor invierte en el comercio buscando tus productos, haciendo filas y coordinando la compra de forma personalizada, además de compensar la financiación de tu pedido en el momento.</p>

        <p style="margin: 0; font-weight: 700; color: var(--color-primary);">Límites y Restricciones:</p>
        <ul style="margin: 0; padding-left: 20px; color: var(--color-text-secondary); display: flex; flex-direction: column; gap: 8px;">
          <li><strong>Paradas extra:</strong> Se cobrará una tarifa adicional fija por cada parada comercial adicional agregada al recorrido original.</li>
          <li><strong>No transportable:</strong> No se realizan compras de objetos grandes o que no puedan llevarse en moto de forma segura. Si el repartidor lo considera, puede decidir cancelar el mandado.</li>
        </ul>
        <button id="modal-entendido-btn" style="margin-top: 10px; width: 100%; height: 48px; border-radius: 12px; border: none; background: var(--color-primary); color: white; font-weight: 800; cursor: pointer; box-shadow: 0 4px 15px rgba(var(--color-primary-rgb), 0.2);">Entendido</button>
      </div>
    `;
  } else if (service === 'gocash') {
    title = '💵 Go Cash (Efectivo/Transferencia)';
    contentHtml = `
      <div style="padding: 20px; font-family: inherit; color: var(--color-text-primary); line-height: 1.5; font-size: 14px; display: flex; flex-direction: column; gap: 16px;">
        <p style="margin: 0; font-weight: 700;">¿Cómo funciona el servicio?</p>
        <p style="margin: 0; color: var(--color-text-secondary);">Cambiá efectivo por dinero virtual o viceversa. El repartidor se acerca a tu dirección a retirar o entregarte el efectivo mientras realizás la transferencia bancaria en su presencia.</p>
        
        <p style="margin: 0; font-weight: 700; color: var(--color-primary);">Límites y Restricciones:</p>
        <ul style="margin: 0; padding-left: 20px; color: var(--color-text-secondary); display: flex; flex-direction: column; gap: 8px;">
          <li><strong>Límite máximo:</strong> La transacción tiene un límite estricto de hasta $70.000 por motivos de seguridad del chofer y del cliente.</li>
          <li><strong>Validación obligatoria:</strong> La transferencia bancaria/Mercado Pago debe realizarse e impactar en la cuenta de destino obligatoriamente frente al repartidor antes del intercambio del efectivo.</li>
        </ul>
        <button id="modal-entendido-btn" style="margin-top: 10px; width: 100%; height: 48px; border-radius: 12px; border: none; background: var(--color-primary); color: white; font-weight: 800; cursor: pointer; box-shadow: 0 4px 15px rgba(var(--color-primary-rgb), 0.2);">Entendido</button>
      </div>
    `;
  } else if (service === 'pagodeservicios') {
    title = '📄 Pago de Servicios / Impuestos';
    contentHtml = `
      <div style="padding: 20px; font-family: inherit; color: var(--color-text-primary); line-height: 1.5; font-size: 14px; display: flex; flex-direction: column; gap: 16px;">
        <p style="margin: 0; font-weight: 700;">¿Cómo funciona el servicio?</p>
        <p style="margin: 0; color: var(--color-text-secondary);">Envía a un repartidor a pagar tus facturas e impuestos (Cyber, ABSA, Canal 4, Rapipago o PagoFácil). Puedes elegir entre recibir el comprobante digitalmente (foto por chat) o recibir el comprobante físico en tu domicilio.</p>
        
        <p style="margin: 0; font-weight: 700; color: var(--color-primary);">Opciones de Envío:</p>
        <ul style="margin: 0; padding-left: 20px; color: var(--color-text-secondary); display: flex; flex-direction: column; gap: 8px;">
          <li><strong>Foto digital:</strong> El repartidor te envía una foto nítida de la factura abonada. Solo se cobra la tarifa base de trámite.</li>
          <li><strong>Comprobante físico:</strong> El repartidor regresa a tu dirección para entregarte el ticket en papel. Esta opción suma un costo de envío logístico adicional por el viaje de regreso.</li>
        </ul>
        <button id="modal-entendido-btn" style="margin-top: 10px; width: 100%; height: 48px; border-radius: 12px; border: none; background: var(--color-primary); color: white; font-weight: 800; cursor: pointer; box-shadow: 0 4px 15px rgba(var(--color-primary-rgb), 0.2);">Entendido</button>
      </div>
    `;
  }

  const modalEl = document.createElement('div');
  modalEl.innerHTML = contentHtml;
  
  const infoModal = showModal({
    title: title,
    content: modalEl,
    height: 'auto',
    hideHeader: false
  });
  
  modalEl.querySelector('#modal-entendido-btn').onclick = () => infoModal.close();
}

function showWarningModal(message) {
  const alertEl = document.createElement('div');
  alertEl.innerHTML = `
    <p style="padding: 32px 24px; text-align: center; color: var(--color-text-secondary); font-size: 15.5px; font-weight: 700; line-height: 1.6; margin: 0;">${message}</p>
    <div style="padding: 0 24px 24px;">
      <button id="alert-ok-btn" class="btn btn-primary" style="width: 100%; height: 54px; border-radius: 18px; font-weight: 900; font-size: 15px; background: var(--color-primary); color: white; border: none; cursor: pointer; box-shadow: 0 6px 20px rgba(var(--color-primary-rgb), 0.2);">Entendido</button>
    </div>
  `;
  const alertModal = showModal({
    title: 'Datos Incompletos',
    content: alertEl,
    hideHeader: false,
    height: 'auto'
  });
  alertEl.querySelector('#alert-ok-btn').onclick = () => alertModal.close();
}

export async function showMandadoForm() {
  const { geocodeAddress, getDistance, calculateDynamicFee } = await import('../utils/geo.js');
  const user = getState().user;
  const currentAddress = '';

  const modalEl = document.createElement('div');
  modalEl.style.cssText = 'padding: 20px 24px calc(16px + env(safe-area-inset-bottom, 16px)); background: var(--color-bg); display: flex; flex-direction: column; box-sizing: border-box;';
  modalEl.innerHTML = `
    <div style="display: flex; flex-direction: column;">
      <!-- Paso 1 Container -->
      <div id="step-1-container" style="display: flex; flex-direction: column; gap: 16px;">
        <div style="max-height: 50dvh; overflow-y: auto; display: flex; flex-direction: column; gap: 16px; padding-bottom: 4px; scrollbar-width: none;">
          <div style="display:flex; flex-direction:column; gap:8px; margin-top:4px;">
            <label style="font-size: 11px; font-weight: 900; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing:0.5px;">Origen: ¿Dónde recogemos?</label>
            <button id="pickup-addr-btn" style="width: 100%; height: 60px; border-radius: 18px; border: 1.5px solid var(--color-border-light); padding: 0 16px; background: var(--color-surface); font-size: 14px; font-weight: 700; display:flex; align-items:center; gap:12px; text-align:left; color:var(--color-text-secondary); cursor:pointer; transition:all 0.2s; box-shadow: var(--shadow-sm);">
               <div style="width:36px; height:36px; border-radius:12px; background:rgba(var(--color-primary-rgb),0.1); color:var(--color-primary); display:flex; align-items:center; justify-content:center; flex-shrink:0;">${icon('mapPin', 20)}</div>
               <span id="pickup-text" style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">Elegir dirección en el mapa...</span>
               ${icon('chevronRight', 16)}
            </button>
            <input type="text" id="pickup-details" placeholder="Detalle: Nro, depto, timbre, local o ref (Obligatorio)" style="height:48px; border-radius:14px; border:1.5px solid var(--color-border-light); padding:0 14px; background:var(--color-surface); color:var(--color-text-primary); font-size:13.5px; font-weight:600; outline:none; transition:all 0.2s;" />
          </div>

          <div style="display:flex; flex-direction:column; gap:8px;">
            <label style="font-size: 11px; font-weight: 900; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing:0.5px;">Destino: ¿Dónde entregamos?</label>
            <button id="delivery-addr-btn" style="width: 100%; height: 60px; border-radius: 18px; border: 1.5px solid var(--color-border-light); padding: 0 16px; background: var(--color-surface); font-size: 14px; font-weight: 700; display:flex; align-items:center; gap:12px; text-align:left; color:var(--color-text-primary); cursor:pointer; transition:all 0.2s; box-shadow: var(--shadow-sm);">
               <div style="width:36px; height:36px; border-radius:12px; background:rgba(34, 197, 94, 0.1); color:#22c55e; display:flex; align-items:center; justify-content:center; flex-shrink:0;">${icon('home', 20)}</div>
               <span id="delivery-text" style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${currentAddress || 'Elegir destino...'}</span>
               ${icon('chevronRight', 16)}
            </button>
            <input type="text" id="delivery-details" value="${currentAddress ? (getState().addressNotes || '') : ''}" placeholder="Detalle: Nro, depto, timbre, local o ref (Obligatorio)" style="height:48px; border-radius:14px; border:1.5px solid var(--color-border-light); padding:0 14px; background:var(--color-surface); color:var(--color-text-primary); font-size:13.5px; font-weight:600; outline:none; transition:all 0.2s;" />
          </div>

          <div style="display:flex; flex-direction:column; gap:8px;">
            <label style="font-size: 11px; font-weight: 900; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing:0.5px; margin-bottom:4px; display:block;">Detalles de la Encomienda</label>
            <textarea id="favor-details" placeholder="Ej: Recoger llaves en el portero y traerlas. Contacto: Juan 123456..." style="width: 100%; height: 100px; border-radius: 16px; border: 1.5px solid var(--color-border-light); padding: 14px; background: var(--color-surface); color: var(--color-text-primary); font-size: 13.5px; font-weight: 600; resize: none; outline:none; font-family:inherit; transition:all 0.2s;"></textarea>
          </div>
        </div>

        <button type="button" id="step-1-next-btn" style="width: 100%; height: 56px; border-radius: 18px; background: var(--color-primary); color: white; border: none; font-weight: 900; font-size: 15px; cursor: pointer; text-transform: uppercase; letter-spacing: 0.05em; display: flex; align-items: center; justify-content: center; gap: 10px; margin-top: 8px; flex-shrink: 0; box-shadow: 0 8px 20px rgba(var(--color-primary-rgb),0.25);">
          Siguiente ${icon('chevronRight', 16)}
        </button>
      </div>

      <!-- Paso 2 Container -->
      <div id="step-2-container" style="display: none; flex-direction: column; gap: 16px;">
        <div style="max-height: 50dvh; overflow-y: auto; display: flex; flex-direction: column; gap: 16px; padding-bottom: 4px; scrollbar-width: none;">
          <button type="button" id="step-2-back-btn" style="background:transparent; border:none; color:var(--color-primary); font-weight:800; cursor:pointer; display:flex; align-items:center; gap:4px; padding:8px 0; font-size:13px; outline:none; text-align:left; width:fit-content;">
            ${icon('chevronLeft', 16)} Volver a Paso 1
          </button>

          <!-- Método de pago -->
          <div style="display:flex; flex-direction:column; gap:8px;">
            <label style="font-size: 11px; font-weight: 900; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing:0.5px;">Método de Pago del Envío</label>
            <div style="display:flex; background:var(--color-bg-secondary); padding:4px; border-radius:16px; border:1.5px solid var(--color-border-light);">
              <button type="button" id="mandado-pay-efectivo" style="flex:1; height:42px; border-radius:12px; border:none; font-size:13px; font-weight:800; cursor:pointer; transition:all 0.2s; background:transparent; color:var(--color-text-secondary); display:flex; align-items:center; justify-content:center; gap:6px;">
                ${icon('dollarSign', 14)} Efectivo
              </button>
              <button type="button" id="mandado-pay-transfer" style="flex:1; height:42px; border-radius:12px; border:none; font-size:13px; font-weight:800; cursor:pointer; transition:all 0.2s; background:transparent; color:var(--color-text-secondary); display:flex; align-items:center; justify-content:center; gap:6px;">
                ${icon('creditCard', 14)} Transferencia
              </button>
            </div>
          </div>

          <!-- Benefits Container -->
          <div id="benefits-container"></div>
          
          <div id="cost-preview" style="background: var(--color-bg-secondary); padding: 16px; border-radius: 20px; display: none; flex-direction:column; gap:8px; border:1px solid var(--color-border-light); margin-top:auto;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span style="font-weight: 600; color: var(--color-text-secondary); font-size: 12px;">Envío (distancia)</span>
              <span id="dist-cost" style="font-size: 13px; font-weight: 700; color: var(--color-text-primary);">$ 0</span>
            </div>
            <div id="mandado-rain-row" style="display:none; justify-content:space-between; align-items:center;">
              <span style="font-weight: 600; color: #009EE3; font-size: 12px; display:flex; align-items:center; gap:4px;">
                ${icon('cloudRain', 14)} Recargo por Lluvia
              </span>
              <span id="mandado-rain-cost" style="font-size: 13px; font-weight: 700; color: #009EE3;">$ 0</span>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span style="font-weight: 600; color: var(--color-text-secondary); font-size: 12px;">Tarifa servicio</span>
              <span id="service-cost" style="font-size: 13px; font-weight: 700; color: var(--color-text-primary);">$ 0</span>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:4px; padding-top:8px; border-top:1px dashed var(--color-border-light);">
              <span style="font-weight: 900; color: #059669; font-size: 15px;">Total Servicio</span>
              <span id="estimated-cost" style="font-size: 20px; font-weight: 950; color: #059669;">$ 0</span>
            </div>
            <p style="font-size: 10px; color: var(--color-text-tertiary); margin-top: 8px; font-weight: 600; text-align: center;">
              * Este es el costo por el servicio de envío.
            </p>
          </div>
        </div>

        <button id="confirm-favor-btn" style="width: 100%; height: 56px; border-radius: 18px; background: #059669; color: white; border: none; font-weight: 900; font-size: 15px; cursor: pointer; box-shadow: 0 8px 20px rgba(5,150,105, 0.25); text-transform: uppercase; letter-spacing: 0.05em; display: flex; align-items: center; justify-content: center; gap: 10px; margin-top: 8px; flex-shrink: 0;">
          ${icon('check', 20)} Solicitar Encomienda
        </button>
      </div>
    </div>
  `;

  showModal({
    title: 'Detalles de la Encomienda',
    content: modalEl,
    height: 'auto',
    hideHeader: false,
    headerBackground: 'linear-gradient(135deg, #059669 0%, #10B981 100%)',
    headerTextColor: '#ffffff'
  });

  const pickupBtn = modalEl.querySelector('#pickup-addr-btn');
  const deliveryBtn = modalEl.querySelector('#delivery-addr-btn');
  const pickupText = modalEl.querySelector('#pickup-text');
  const deliveryText = modalEl.querySelector('#delivery-text');
  const detailsInput = modalEl.querySelector('#favor-details');
  const previewBox = modalEl.querySelector('#cost-preview');
  const distCostEl = modalEl.querySelector('#dist-cost');
  const serviceCostEl = modalEl.querySelector('#service-cost');
  const totalCostEl = modalEl.querySelector('#estimated-cost');

  let pickupData = null;
  let deliveryData = currentAddress ? { address: currentAddress, coords: getState().deliveryCoords } : null;
  let calculatedFee = 0;
  let appFee = 0;
  let selectedPaymentMethod = null;
  let selectedTip = 0;
  let appliedCoupon = null;

  const payEfectivoBtn = modalEl.querySelector('#mandado-pay-efectivo');
  const payTransferBtn = modalEl.querySelector('#mandado-pay-transfer');

  const benefitsContainer = modalEl.querySelector('#benefits-container');
  renderBenefitsSection(benefitsContainer, (tip, coupon) => {
    selectedTip = tip;
    appliedCoupon = coupon;
    updateCost();
  }, () => calculatedFee);

  const updateDetailsFieldsState = () => {
    const pickupDetailsInput = modalEl.querySelector('#pickup-details');
    const deliveryDetailsInput = modalEl.querySelector('#delivery-details');
    const favorDetailsInput = modalEl.querySelector('#favor-details');

    if (pickupData) {
      pickupDetailsInput.disabled = false;
      pickupDetailsInput.style.opacity = '1';
      pickupDetailsInput.style.cursor = 'text';
      pickupDetailsInput.placeholder = 'Detalle: Nro, depto, timbre, local o ref (Obligatorio)';
    } else {
      pickupDetailsInput.disabled = true;
      pickupDetailsInput.style.opacity = '0.6';
      pickupDetailsInput.style.cursor = 'not-allowed';
      pickupDetailsInput.placeholder = 'Primero selecciona el origen...';
    }

    if (deliveryData) {
      deliveryDetailsInput.disabled = false;
      deliveryDetailsInput.style.opacity = '1';
      deliveryDetailsInput.style.cursor = 'text';
      deliveryDetailsInput.placeholder = 'Detalle: Nro, depto, timbre, local o ref (Obligatorio)';
    } else {
      deliveryDetailsInput.disabled = true;
      deliveryDetailsInput.style.opacity = '0.6';
      deliveryDetailsInput.style.cursor = 'not-allowed';
      deliveryDetailsInput.placeholder = 'Primero selecciona la dirección de destino...';
    }

    if (pickupData && deliveryData) {
      favorDetailsInput.disabled = false;
      favorDetailsInput.style.opacity = '1';
      favorDetailsInput.style.cursor = 'text';
      favorDetailsInput.placeholder = 'Ej: Recoger llaves en el portero y traerlas. Contacto: Juan 123456...';
    } else {
      favorDetailsInput.disabled = true;
      favorDetailsInput.style.opacity = '0.6';
      favorDetailsInput.style.cursor = 'not-allowed';
      favorDetailsInput.placeholder = 'Primero selecciona origen y destino...';
    }
  };

  // Call initially to disable fields
  updateDetailsFieldsState();

  payEfectivoBtn.onclick = () => {
    selectedPaymentMethod = 'efectivo';
    payEfectivoBtn.style.background = '#059669';
    payEfectivoBtn.style.color = '#ffffff';
    payEfectivoBtn.style.boxShadow = '0 4px 12px rgba(5, 150, 105, 0.2)';
    payTransferBtn.style.background = 'transparent';
    payTransferBtn.style.color = 'var(--color-text-secondary)';
    payTransferBtn.style.boxShadow = 'none';
  };

  payTransferBtn.onclick = () => {
    selectedPaymentMethod = 'mercadopago';
    payTransferBtn.style.background = '#2563EB';
    payTransferBtn.style.color = '#ffffff';
    payTransferBtn.style.boxShadow = '0 4px 12px rgba(37, 99, 235, 0.2)';
    payEfectivoBtn.style.background = 'transparent';
    payEfectivoBtn.style.color = 'var(--color-text-secondary)';
    payEfectivoBtn.style.boxShadow = 'none';
  };

  const updateCost = async () => {
    if (pickupData && deliveryData) {
      try {
        const dist = await getDistance(pickupData.coords.lat, pickupData.coords.lng, deliveryData.coords.lat, deliveryData.coords.lng);
        calculatedFee = calculateDynamicFee(dist);
        
        const config = getState().servicesAppFeeConfig?.gofavor || { type: 'percentage', value: 1.2 };
        if (config.type === 'fixed') {
          appFee = config.value;
        } else {
          appFee = Math.ceil((calculatedFee * (config.value / 100)) / 10) * 10;
        }

        let couponDiscount = 0;
        if (appliedCoupon) {
          if (appliedCoupon.type === 'free_delivery') {
            couponDiscount = calculatedFee;
          } else if (appliedCoupon.discountType === 'percentage') {
            couponDiscount = Math.floor(calculatedFee * (Number(appliedCoupon.value || 0) / 100));
          } else {
            couponDiscount = Number(appliedCoupon.value || 0);
          }
        }

        const rainSurcharge = getState().isRaining ? (getState().deliveryRainSurcharge || 300) : 0;
        const total = Math.max(calculatedFee + rainSurcharge + appFee - couponDiscount + selectedTip, 0);

        distCostEl.textContent = formatPrice(calculatedFee);
        
        const rainRow = modalEl.querySelector('#mandado-rain-row');
        const rainCostEl = modalEl.querySelector('#mandado-rain-cost');
        if (rainSurcharge > 0) {
          if (rainRow) rainRow.style.display = 'flex';
          if (rainCostEl) rainCostEl.textContent = `+ ${formatPrice(rainSurcharge)}`;
        } else {
          if (rainRow) rainRow.style.display = 'none';
        }

        serviceCostEl.textContent = formatPrice(appFee);

        let couponRow = previewBox.querySelector('.coupon-preview-row');
        const estimatedFeeRow = totalCostEl.parentElement;
        if (couponDiscount > 0) {
          if (!couponRow) {
            couponRow = document.createElement('div');
            couponRow.className = 'coupon-preview-row';
            couponRow.style.cssText = 'display:flex; justify-content:space-between; align-items:center; color:#a855f7; font-weight:700;';
            previewBox.insertBefore(couponRow, estimatedFeeRow);
          }
          couponRow.innerHTML = `<span>Descuento cupón (${appliedCoupon.code})</span><span>-${formatPrice(couponDiscount)}</span>`;
          couponRow.style.display = 'flex';
        } else if (couponRow) {
          couponRow.style.display = 'none';
        }

        let tipRow = previewBox.querySelector('.tip-preview-row');
        if (selectedTip > 0) {
          if (!tipRow) {
            tipRow = document.createElement('div');
            tipRow.className = 'tip-preview-row';
            tipRow.style.cssText = 'display:flex; justify-content:space-between; align-items:center; color:#10b981; font-weight:700;';
            previewBox.insertBefore(tipRow, estimatedFeeRow);
          }
          tipRow.innerHTML = `<span>Propina</span><span>+ ${formatPrice(selectedTip)}</span>`;
          tipRow.style.display = 'flex';
        } else if (tipRow) {
          tipRow.style.display = 'none';
        }

        totalCostEl.textContent = formatPrice(total);
        previewBox.style.display = 'flex';
      } catch (e) {}
    }
  };

  modalEl.querySelector('#step-1-next-btn').onclick = () => {
    const pickupDetailsInput = modalEl.querySelector('#pickup-details');
    const deliveryDetailsInput = modalEl.querySelector('#delivery-details');
    const pickupDetails = pickupDetailsInput ? pickupDetailsInput.value.trim() : '';
    const deliveryDetails = deliveryDetailsInput ? deliveryDetailsInput.value.trim() : '';

    if (!pickupData) {
      showWarningModal('Por favor, selecciona la dirección de origen (¿Dónde recogemos?)');
      return;
    }
    if (!pickupDetails) {
      showWarningModal('Por favor, ingresa el detalle de la dirección de origen (Nro, depto, ref...)');
      return;
    }
    if (!deliveryData) {
      showWarningModal('Por favor, selecciona la dirección de destino (¿Dónde entregamos?)');
      return;
    }
    if (!deliveryDetails) {
      showWarningModal('Por favor, ingresa el detalle de la dirección de destino (Nro, depto, ref...)');
      return;
    }
    if (!detailsInput.value.trim()) {
      showWarningModal('Por favor, ingresa los detalles del paquete o encomienda a enviar');
      return;
    }

    modalEl.querySelector('#step-1-container').style.display = 'none';
    modalEl.querySelector('#step-2-container').style.display = 'flex';
  };

  modalEl.querySelector('#step-2-back-btn').onclick = () => {
    modalEl.querySelector('#step-1-container').style.display = 'flex';
    modalEl.querySelector('#step-2-container').style.display = 'none';
  };

  pickupBtn.onclick = () => {
    showAddressPrompt((addr, notes, coords) => {
      pickupData = { address: addr, coords };
      pickupText.textContent = addr;
      pickupText.style.color = 'var(--color-text-primary)';
      updateDetailsFieldsState();
      
      const pickupDetailsInput = modalEl.querySelector('#pickup-details');
      if (pickupDetailsInput && notes) {
        pickupDetailsInput.value = notes;
      }
      
      updateCost();
    }, { mode: 'pick' });
  };

  deliveryBtn.onclick = () => {
    showAddressPrompt((addr, notes, coords) => {
      deliveryData = { address: addr, coords };
      deliveryText.textContent = addr;
      updateDetailsFieldsState();
      
      const deliveryDetailsInput = modalEl.querySelector('#delivery-details');
      if (deliveryDetailsInput && notes) {
        deliveryDetailsInput.value = notes;
      }
      
      updateCost();
    }, { mode: 'pick' });
  };

  modalEl.querySelector('#confirm-favor-btn').onclick = async () => {
    const pickupDetailsInput = modalEl.querySelector('#pickup-details');
    const deliveryDetailsInput = modalEl.querySelector('#delivery-details');
    const pickupDetails = pickupDetailsInput ? pickupDetailsInput.value.trim() : '';
    const deliveryDetails = deliveryDetailsInput ? deliveryDetailsInput.value.trim() : '';

    if (!selectedPaymentMethod) {
      showWarningModal('Por favor, selecciona un método de pago del envío (Efectivo o Transferencia)');
      return;
    }
    if (!pickupData) {
      showWarningModal('Por favor, selecciona la dirección de origen (¿Dónde recogemos?)');
      return;
    }
    if (!pickupDetails) {
      showWarningModal('Por favor, ingresa el detalle de la dirección de origen (Nro, depto, ref...)');
      return;
    }
    if (!deliveryData) {
      showWarningModal('Por favor, selecciona la dirección de destino (¿Dónde entregamos?)');
      return;
    }
    if (!deliveryDetails) {
      showWarningModal('Por favor, ingresa el detalle de la dirección de destino (Nro, depto, ref...)');
      return;
    }
    if (!detailsInput.value.trim()) {
      showWarningModal('Por favor, ingresa los detalles del paquete o encomienda a enviar');
      return;
    }

    if (calculatedFee === 0) {
      await updateCost();
    }

    let couponDiscount = 0;
    if (appliedCoupon) {
      if (appliedCoupon.type === 'free_delivery') {
        couponDiscount = calculatedFee;
      } else if (appliedCoupon.discountType === 'percentage') {
        couponDiscount = Math.floor(calculatedFee * (Number(appliedCoupon.value || 0) / 100));
      } else {
        couponDiscount = Number(appliedCoupon.value || 0);
      }
    }

    const rainSurcharge = getState().isRaining ? (getState().deliveryRainSurcharge || 300) : 0;
    const total = Math.max(calculatedFee + rainSurcharge + appFee - couponDiscount + selectedTip, 0);

    showConfirm({
      title: '¿Confirmar encomienda?',
      message: `Se enviará un repartidor para realizar tu envío de encomienda.<br><br>Costo del servicio: <strong>${formatPrice(total)}</strong>`,
      onConfirm: async () => {
        try {
          const orderId = await createFavorOrder({
            type: 'mandado',
            pickupAddress: `${pickupData.address} (Detalle: ${pickupDetails})`,
            pickupCoords: pickupData.coords,
            deliveryAddress: `${deliveryData.address} (Detalle: ${deliveryDetails})`,
            deliveryCoords: deliveryData.coords,
            details: detailsInput.value.trim(),
            deliveryCost: calculatedFee + rainSurcharge,
            appUsageFee: appFee,
            tip: selectedTip,
            couponCode: appliedCoupon ? appliedCoupon.code : null,
            couponDiscount: couponDiscount,
            total: total,
            paymentMethod: selectedPaymentMethod
          });
          closeModal();
          setTimeout(() => {
            location.hash = `#/pedido/${orderId}`;
          }, 150);
        } catch (e) {
          console.error('Error creating Mandado favor:', e);
          showToast('Error al crear favor: ' + e.message, 'error');
        }
      }
    });
  };
}

async function createFavorOrder(data) {
  const { auth } = await import('../firebase.js');
  const { doc, getDoc } = await import('firebase/firestore');
  const { db } = await import('../firebase.js');
  
  const user = auth.currentUser;
  if (!user) throw new Error('Usuario no autenticado');
  const idToken = await user.getIdToken();

  const body = {
    type: data.type,
    pickupAddress: data.pickupAddress,
    pickupCoords: data.pickupCoords,
    deliveryAddress: data.deliveryAddress,
    deliveryCoords: data.deliveryCoords,
    details: data.details,
    deliveryCost: data.deliveryCost,
    purchaseFee: data.purchaseFee || 0,
    extraStopsFee: data.extraStopsFee || 0,
    stopsCount: data.stopsCount || 1,
    appUsageFee: data.appUsageFee || 0,
    total: data.total,
    paymentMethod: data.paymentMethod,
    tip: data.tip || 0,
    couponCode: data.couponCode || null,
    couponDiscount: data.couponDiscount || 0,
    receiptDeliveryType: data.receiptDeliveryType || null
  };

  if (data.isGoCash) {
    body.isGoCash = true;
    body.goCashAmount = data.goCashAmount;
    body.goCashType = data.goCashType;
  }

  const response = await fetch('https://us-central1-godelivery-magdalena.cloudfunctions.net/createFavorOrder', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${idToken}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errData = await response.json();
    throw new Error(errData.error || 'Error al procesar el favor en el servidor');
  }

  const resData = await response.json();

  // Save last address to Firestore
  return resData.orderId;
}

export async function showCompraForm() {
  const { getDistance, calculateDynamicFee } = await import('../utils/geo.js');
  const user = getState().user;
  const currentAddress = '';
  const purchaseFee = getState().favorPurchaseFee || 800;

  const modalEl = document.createElement('div');
  modalEl.style.cssText = 'padding: 20px 24px calc(16px + env(safe-area-inset-bottom, 16px)); background: var(--color-bg); display: flex; flex-direction: column; box-sizing: border-box;';
  modalEl.innerHTML = `
    <div style="display: flex; flex-direction: column;">
      
      <!-- Paso 1 Container -->
      <div id="compra-step-1-container" style="display: flex; flex-direction: column; gap: 16px;">
        <div style="max-height: 50dvh; overflow-y: auto; display: flex; flex-direction: column; gap: 16px; padding-bottom:4px; scrollbar-width: none;">
          <div style="display:flex; flex-direction:column; gap:12px; margin-top: 4px;">
            <label style="font-size: 11px; font-weight: 900; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing:0.5px;">¿Cuántos comercios querés visitar?</label>
            <div style="display:grid; grid-template-columns: repeat(5, 1fr); gap:8px;">
              ${[1, 2, 3, 4, 5].map(n => `
                <button type="button" class="stop-count-btn" data-stops="${n}" style="height:48px; border-radius:16px; border:2px solid ${n === 1 ? 'var(--color-primary)' : 'var(--color-border-light)'}; background:${n === 1 ? 'rgba(var(--color-primary-rgb),0.08)' : 'var(--color-surface)'}; color:${n === 1 ? 'var(--color-primary)' : 'var(--color-text-primary)'}; font-weight:900; font-size:15px; cursor:pointer; transition:all 0.2s; box-shadow: ${n === 1 ? '0 4px 12px rgba(var(--color-primary-rgb), 0.15)' : 'none'};">
                  ${n}
                </button>
              `).join('')}
            </div>
            <p id="extra-stop-note" style="font-size:10px; color:var(--color-text-tertiary); margin:4px 0 0; font-weight:600; display:none; line-height:1.4;">
              📍 Se cobra una parada extra por cada comercio adicional al primero.
            </p>
          </div>

          <!-- Dynamically generated list of stores -->
          <div id="stores-subforms-container" style="display:flex; flex-direction:column; gap:16px;">
            <!-- Filled dynamically -->
          </div>

          <!-- Delivery destination -->
          <div style="display:flex; flex-direction:column; gap:8px;">
            <label style="font-size: 11px; font-weight: 900; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing:0.5px;">¿Dónde entregamos?</label>
            <button id="delivery-addr-btn" style="width: 100%; height: 60px; border-radius: 18px; border: 1.5px solid var(--color-border-light); padding: 0 16px; background: var(--color-surface); font-size: 14px; font-weight: 700; display:flex; align-items:center; gap:12px; text-align:left; color:var(--color-text-primary); cursor:pointer; transition:all 0.2s; box-shadow: var(--shadow-sm);">
               <div style="width:36px; height:36px; border-radius:12px; background:rgba(34, 197, 94, 0.1); color:#22c55e; display:flex; align-items:center; justify-content:center; flex-shrink:0;">${icon('home', 20)}</div>
               <span id="delivery-text" style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${currentAddress || 'Elegir destino...'}</span>
               ${icon('chevronRight', 16)}
            </button>
            <input type="text" id="delivery-details" value="${currentAddress ? (getState().addressNotes || '') : ''}" placeholder="Detalle: Nro, depto, timbre, local o ref (Obligatorio)" style="height:48px; border-radius:14px; border:1.5px solid var(--color-border-light); padding:0 14px; background:var(--color-surface); color:var(--color-text-primary); font-size:13.5px; font-weight:600; outline:none; transition:all 0.2s;" />
          </div>
        </div>

        <button type="button" id="compra-step-1-next-btn" style="width: 100%; height: 56px; border-radius: 18px; background: var(--color-primary); color: white; border: none; font-weight: 900; font-size: 15px; cursor: pointer; text-transform: uppercase; letter-spacing: 0.05em; display: flex; align-items: center; justify-content: center; gap: 10px; margin-top: 8px; flex-shrink: 0; box-shadow: 0 8px 20px rgba(var(--color-primary-rgb),0.25);">
          Siguiente ${icon('chevronRight', 16)}
        </button>
      </div>

      <!-- Paso 2 Container -->
      <div id="compra-step-2-container" style="display: none; flex-direction: column; gap: 16px;">
        <div style="max-height: 50dvh; overflow-y: auto; display: flex; flex-direction: column; gap: 16px; padding-bottom:4px; scrollbar-width: none;">
          <button type="button" id="compra-step-2-back-btn" style="background:transparent; border:none; color:var(--color-primary); font-weight:800; cursor:pointer; display:flex; align-items:center; gap:4px; padding:8px 0; font-size:13px; outline:none; text-align:left; width:fit-content;">
            ${icon('chevronLeft', 16)} Volver a Paso 1
          </button>

          <!-- Método de pago -->
          <div style="display:flex; flex-direction:column; gap:8px;">
            <label style="font-size: 11px; font-weight: 900; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing:0.5px;">Método de Pago del Envío</label>
            <div style="display:flex; background:var(--color-bg-secondary); padding:4px; border-radius:16px; border:1.5px solid var(--color-border-light);">
              <button type="button" id="compra-pay-efectivo" style="flex:1; height:42px; border-radius:12px; border:none; font-size:13px; font-weight:800; cursor:pointer; transition:all 0.2s; background:transparent; color:var(--color-text-secondary); display:flex; align-items:center; justify-content:center; gap:6px;">
                ${icon('dollarSign', 14)} Efectivo
              </button>
              <button type="button" id="compra-pay-transfer" style="flex:1; height:42px; border-radius:12px; border:none; font-size:13px; font-weight:800; cursor:pointer; transition:all 0.2s; background:transparent; color:var(--color-text-secondary); display:flex; align-items:center; justify-content:center; gap:6px;">
                ${icon('creditCard', 14)} Transferencia
              </button>
            </div>
          </div>
          
          <!-- Benefits Container -->
          <div id="compra-benefits-container"></div>
          
          <!-- Cost Preview -->
          <div id="compra-cost-preview" style="background: var(--color-bg-secondary); padding: 16px; border-radius: 20px; display: none; flex-direction:column; gap:10px; border:1px solid var(--color-border-light); margin-top:auto;">
            <div style="display:flex; justify-content:space-between; align-items:center; font-size:13px; font-weight:800; color:var(--color-text-primary);">
              <span style="display:flex; align-items:center; gap:6px;">
                Costo de Envío
                <button type="button" id="compra-info-btn" style="border:none; background:transparent; padding:4px; cursor:pointer; color:#E11D48; display:flex; align-items:center; justify-content:center; outline:none; transition:transform 0.2s;">
                  ${icon('info', 16)}
                </button>
              </span>
              <span id="compra-summary-total" style="font-weight:900;">$ ---</span>
            </div>
            
            <div id="compra-rain-row" style="display:none; justify-content:space-between; align-items:center; font-size:13px; font-weight:800; color:#009EE3;">
              <span style="display:flex; align-items:center; gap:6px;">
                ${icon('cloudRain', 16)} Recargo por Lluvia
              </span>
              <span id="compra-rain-cost" style="font-weight:900;">$ 0</span>
            </div>

            <div style="display:flex; justify-content:space-between; font-size:16px; font-weight:950; color:#E11D48; border-top:2px dashed var(--color-border-light); padding-top:12px; margin-top:2px;">
              <span>Total Servicio</span><span id="final-service-fee">$ ---</span>
            </div>
            <p style="font-size:10px; color:var(--color-text-tertiary); margin-top:4px; line-height:1.3; font-weight:600; text-align:center;">
              * El valor de los productos se abona al repartidor al recibirlos.
            </p>
          </div>
        </div>

        <button id="confirm-buy-btn" style="width:100%; height:56px; border-radius:18px; background:#E11D48; color:white; border:none; font-weight:900; font-size:15px; cursor:pointer; box-shadow:0 8px 20px rgba(225,29,72,0.25); text-transform:uppercase; letter-spacing:0.05em; display:flex; align-items:center; justify-content:center; gap:10px; flex-shrink:0;">
          ${icon('check', 20)} Solicitar Compra
        </button>
      </div>
    </div>
  `;

  showModal({
    title: 'Mandado: Comprar algo',
    content: modalEl,
    height: 'auto',
    hideHeader: false,
    headerBackground: 'linear-gradient(135deg, #E11D48 0%, #F43F5E 100%)',
    headerTextColor: '#ffffff'
  });

  const deliveryBtn   = modalEl.querySelector('#delivery-addr-btn');
  const deliveryText  = modalEl.querySelector('#delivery-text');
  const totalFeeEl    = modalEl.querySelector('#final-service-fee');
  const extraStopNote = modalEl.querySelector('#extra-stop-note');
  const previewBox    = modalEl.querySelector('#compra-cost-preview');
  const subformsContainer = modalEl.querySelector('#stores-subforms-container');

  const centerCoords = { lat: -35.0811, lng: -57.5146 };
  let deliveryData = currentAddress ? { address: currentAddress, coords: getState().deliveryCoords } : null;
  let calculatedDistFee = 0;
  let appFee = 0;
  let stopsCount = 1;
  const extraStopFee = getState().deliveryExtraStopFee || 500;
  let selectedPaymentMethod = null;
  let selectedTip = 0;
  let appliedCoupon = null;
  let couponDiscount = 0;
  let total = 0;

  const infoBtn = modalEl.querySelector('#compra-info-btn');
  if (infoBtn) {
    infoBtn.onclick = async (e) => {
      e.stopPropagation();
      const { showModal } = await import('../components/modal.js');
      
      let breakdownHtml = `
        <div style="padding:10px 4px; display:flex; flex-direction:column; text-align:left;">
          <div style="font-size:12.5px; color:var(--color-text-secondary); line-height:1.5; margin-bottom:18px; font-weight:600;">
            A continuación se detalla el desglose del costo de envío para este pedido:
          </div>
          
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; font-size:13px;">
            <div style="display:flex; align-items:center; gap:10px;">
              <div style="width:28px; height:28px; border-radius:8px; background:rgba(225,29,72,0.08); color:#E11D48; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                ${icon('mapPin', 14)}
              </div>
              <span style="color:var(--color-text-secondary); font-weight:600;">Envío (distancia)</span>
            </div>
            <span style="font-weight:800; color:var(--color-text-primary);">${formatPrice(calculatedDistFee)}</span>
          </div>

          ${getState().isRaining ? `
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; font-size:13px; padding-top:12px; border-top:1px dashed var(--color-border-light);">
              <div style="display:flex; align-items:center; gap:10px;">
                <div style="width:28px; height:28px; border-radius:8px; background:rgba(0,158,227,0.08); color:#009EE3; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                  ${icon('cloudRain', 14)}
                </div>
                <span style="color:var(--color-text-secondary); font-weight:600;">Recargo por Lluvia</span>
              </div>
              <span style="font-weight:800; color:#009EE3;">+ ${formatPrice(getState().deliveryRainSurcharge || 300)}</span>
            </div>
          ` : ''}

          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; font-size:13px; padding-top:12px; border-top:1px dashed var(--color-border-light);">
            <div style="display:flex; align-items:center; gap:10px;">
              <div style="width:28px; height:28px; border-radius:8px; background:rgba(34,197,94,0.08); color:#22C55E; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                ${icon('shoppingBag', 14)}
              </div>
              <span style="color:var(--color-text-secondary); font-weight:600;">Gestión Especial</span>
            </div>
            <span style="font-weight:800; color:var(--color-text-primary);">${formatPrice(purchaseFee)}</span>
          </div>

          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; font-size:13px; padding-top:12px; border-top:1px dashed var(--color-border-light);">
            <div style="display:flex; align-items:center; gap:10px;">
              <div style="width:28px; height:28px; border-radius:8px; background:rgba(168,85,247,0.08); color:#a855f7; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                ${icon('info', 14)}
              </div>
              <span style="color:var(--color-text-secondary); font-weight:600;">Servicio App</span>
            </div>
            <span style="font-weight:800; color:var(--color-text-primary);">${formatPrice(appFee)}</span>
          </div>
      `;

      if (stopsCount > 1) {
        const extraStopsTotal = (stopsCount - 1) * extraStopFee;
        breakdownHtml += `
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; font-size:13px; padding-top:12px; border-top:1px dashed var(--color-border-light);">
            <div style="display:flex; align-items:center; gap:10px;">
              <div style="width:28px; height:28px; border-radius:8px; background:rgba(59,130,246,0.08); color:#3b82f6; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                ${icon('route', 14)}
              </div>
              <span style="color:var(--color-text-secondary); font-weight:600;">Paradas extra (×${stopsCount - 1})</span>
            </div>
            <span style="font-weight:800; color:var(--color-text-primary);">+ ${formatPrice(extraStopsTotal)}</span>
          </div>
        `;
      }

      if (appliedCoupon && couponDiscount > 0) {
        breakdownHtml += `
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; font-size:13px; padding-top:12px; border-top:1px dashed var(--color-border-light);">
            <div style="display:flex; align-items:center; gap:10px;">
              <div style="width:28px; height:28px; border-radius:8px; background:rgba(168,85,247,0.08); color:#a855f7; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                ${icon('tag', 14)}
              </div>
              <span style="color:var(--color-text-secondary); font-weight:600;">Descuento cupón (${appliedCoupon.code})</span>
            </div>
            <span style="font-weight:800; color:#a855f7;">-${formatPrice(couponDiscount)}</span>
          </div>
        `;
      }

      if (selectedTip > 0) {
        breakdownHtml += `
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; font-size:13px; padding-top:12px; border-top:1px dashed var(--color-border-light);">
            <div style="display:flex; align-items:center; gap:10px;">
              <div style="width:28px; height:28px; border-radius:8px; background:rgba(16,185,129,0.08); color:#10b981; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                ${icon('heart', 14)}
              </div>
              <span style="color:var(--color-text-secondary); font-weight:600;">Propina al Repartidor</span>
            </div>
            <span style="font-weight:800; color:#10b981;">+ ${formatPrice(selectedTip)}</span>
          </div>
        `;
      }

      breakdownHtml += `
          <div style="display:flex; align-items:center; justify-content:space-between; margin-top:16px; padding-top:16px; font-size:16px; font-weight:900; color:var(--color-text-primary); border-top:2px dashed var(--color-border-light);">
            <div style="display:flex; align-items:center; gap:10px;">
              <div style="width:32px; height:32px; border-radius:10px; background:rgba(225,29,72,0.1); color:#E11D48; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                ${icon('truck', 16)}
              </div>
              <span style="font-family:var(--font-display); font-weight:900; color:var(--color-text-primary);">Total del Envío</span>
            </div>
            <span style="font-size:18px; font-weight:900; color:#E11D48;">${formatPrice(total)}</span>
          </div>
        </div>
      `;

      showModal({
        title: 'Detalle del Envío',
        height: 'auto',
        content: breakdownHtml
      });
    };
  }



  const payEfectivoBtn = modalEl.querySelector('#compra-pay-efectivo');
  const payTransferBtn = modalEl.querySelector('#compra-pay-transfer');

  const benefitsContainer = modalEl.querySelector('#compra-benefits-container');
  renderBenefitsSection(benefitsContainer, (tip, coupon) => {
    selectedTip = tip;
    appliedCoupon = coupon;
    updateCost();
  }, () => calculatedDistFee);

  payEfectivoBtn.onclick = () => {
    selectedPaymentMethod = 'efectivo';
    payEfectivoBtn.style.background = '#059669';
    payEfectivoBtn.style.color = '#ffffff';
    payEfectivoBtn.style.boxShadow = '0 4px 12px rgba(5, 150, 105, 0.2)';
    payTransferBtn.style.background = 'transparent';
    payTransferBtn.style.color = 'var(--color-text-secondary)';
    payTransferBtn.style.boxShadow = 'none';
  };

  payTransferBtn.onclick = () => {
    selectedPaymentMethod = 'mercadopago';
    payTransferBtn.style.background = '#2563EB';
    payTransferBtn.style.color = '#ffffff';
    payTransferBtn.style.boxShadow = '0 4px 12px rgba(37, 99, 235, 0.2)';
    payEfectivoBtn.style.background = 'transparent';
    payEfectivoBtn.style.color = 'var(--color-text-secondary)';
    payEfectivoBtn.style.boxShadow = 'none';
  };

  const placeholders = [
    { name: 'Ej: Verdulería "El Trébol"', details: 'Ej: 1kg papas, 1/2kg tomates, 1 verdeo...' },
    { name: 'Ej: Kiosco "Al Paso"', details: 'Ej: 2 alfajores de chocolate, 1 gaseosa 1.5L...' },
    { name: 'Ej: Panadería "La Unión"', details: 'Ej: 1/2 docena de facturas surtidas, 1 pan de campo...' },
    { name: 'Ej: Carnicería "Magdalena"', details: 'Ej: 1kg de asado, 1/2kg de picada común...' },
    { name: 'Ej: Farmacia "Pasteur"', details: 'Ej: 1 jabón neutro, 1 pasta dental triple acción...' }
  ];

  const renderSubforms = () => {
    subformsContainer.innerHTML = '';
    for (let i = 0; i < stopsCount; i++) {
      const pl = placeholders[i] || placeholders[0];
      const stopDiv = document.createElement('div');
      stopDiv.style.cssText = 'display:flex; flex-direction:column; gap:8px; padding:12px; background:var(--color-bg-secondary); border-radius:18px; border:1px solid var(--color-border-light);';
      stopDiv.innerHTML = `
        <span style="font-size:10px; font-weight:900; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.5px;">Parada ${i + 1}</span>
        <input type="text" class="store-name-input" placeholder="${pl.name}" style="height:44px; border-radius:12px; border:1.5px solid var(--color-border-light); padding:0 12px; background:var(--color-bg-card); font-size:13px; font-weight:700; outline:none;" required />
        <textarea class="store-detail-textarea" placeholder="${pl.details}" style="width:100%; height:76px; border-radius:12px; border:1.5px solid var(--color-border-light); padding:10px 12px; background:var(--color-bg-card); font-size:13px; font-weight:600; resize:none; outline:none; font-family:inherit;" required></textarea>
      `;
      subformsContainer.appendChild(stopDiv);
    }
  };

  renderSubforms();

  modalEl.querySelectorAll('.stop-count-btn').forEach(btn => {
    btn.onclick = () => {
      modalEl.querySelectorAll('.stop-count-btn').forEach(b => {
        b.style.border = '2px solid var(--color-border-light)';
        b.style.background = 'var(--color-bg-card)';
        b.style.color = 'var(--color-text-secondary)';
      });
      btn.style.border = '2px solid var(--color-primary)';
      btn.style.background = 'rgba(var(--color-primary-rgb),0.08)';
      btn.style.color = 'var(--color-primary)';
      stopsCount = parseInt(btn.dataset.stops);
      extraStopNote.style.display = stopsCount > 1 ? 'block' : 'none';
      renderSubforms();
      updateCost();
    };
  });

  const updateCost = async () => {
    if (!deliveryData?.coords) return;
    try {
      const dist = await getDistance(centerCoords.lat, centerCoords.lng, deliveryData.coords.lat, deliveryData.coords.lng);
      calculatedDistFee = calculateDynamicFee(dist);

      const extraStopsTotal = (stopsCount - 1) * extraStopFee;
      const subtotal = calculatedDistFee + purchaseFee + extraStopsTotal;
      const config = getState().servicesAppFeeConfig?.gofavor || { type: 'percentage', value: 1.2 };
      if (config.type === 'fixed') {
        appFee = config.value;
      } else {
        appFee = Math.ceil((subtotal * (config.value / 100)) / 10) * 10;
      }

      couponDiscount = 0;
      if (appliedCoupon) {
        if (appliedCoupon.type === 'free_delivery') {
          couponDiscount = calculatedDistFee;
        } else if (appliedCoupon.discountType === 'percentage') {
          couponDiscount = Math.floor(calculatedDistFee * (Number(appliedCoupon.value || 0) / 100));
        } else {
          couponDiscount = Number(appliedCoupon.value || 0);
        }
      }

      const rainSurcharge = getState().isRaining ? (getState().deliveryRainSurcharge || 300) : 0;
      total = Math.max(subtotal + rainSurcharge + appFee - couponDiscount + selectedTip, 0);

      const summaryTotalEl = modalEl.querySelector('#compra-summary-total');
      if (summaryTotalEl) {
        summaryTotalEl.textContent = formatPrice(calculatedDistFee + extraStopsTotal);
      }

      const rainRow = modalEl.querySelector('#compra-rain-row');
      const rainCostEl = modalEl.querySelector('#compra-rain-cost');
      if (rainSurcharge > 0) {
        if (rainRow) rainRow.style.display = 'flex';
        if (rainCostEl) rainCostEl.textContent = `+ ${formatPrice(rainSurcharge)}`;
      } else {
        if (rainRow) rainRow.style.display = 'none';
      }

      totalFeeEl.textContent = formatPrice(total);
      previewBox.style.display = 'flex';
    } catch (e) { console.error(e); }
  };

  modalEl.querySelector('#compra-step-1-next-btn').onclick = () => {
    const nameInputs = Array.from(subformsContainer.querySelectorAll('.store-name-input'));
    const detailTextareas = Array.from(subformsContainer.querySelectorAll('.store-detail-textarea'));
    const deliveryDetailsInput = modalEl.querySelector('#delivery-details');
    const deliveryDetails = deliveryDetailsInput ? deliveryDetailsInput.value.trim() : '';

    let validated = true;
    for (let i = 0; i < stopsCount; i++) {
      const name = nameInputs[i].value.trim();
      const details = detailTextareas[i].value.trim();
      if (!name || !details) {
        validated = false;
        nameInputs[i].style.borderColor = 'var(--color-primary)';
        detailTextareas[i].style.borderColor = 'var(--color-primary)';
      } else {
        nameInputs[i].style.borderColor = 'var(--color-border-light)';
        detailTextareas[i].style.borderColor = 'var(--color-border-light)';
      }
    }

    if (!validated) {
      showWarningModal('Por favor, ingresa los nombres de los comercios y el detalle de los productos a comprar');
      return;
    }
    if (!deliveryData) {
      showWarningModal('Por favor, selecciona la dirección de entrega');
      return;
    }
    if (!deliveryDetails) {
      showWarningModal('Por favor, ingresa el detalle de la dirección de entrega (Nro, depto, ref...)');
      return;
    }

    modalEl.querySelector('#compra-step-1-container').style.display = 'none';
    modalEl.querySelector('#compra-step-2-container').style.display = 'flex';
  };

  modalEl.querySelector('#compra-step-2-back-btn').onclick = () => {
    modalEl.querySelector('#compra-step-1-container').style.display = 'flex';
    modalEl.querySelector('#compra-step-2-container').style.display = 'none';
  };

  deliveryBtn.onclick = () => {
    showAddressPrompt((addr, notes, coords) => {
      deliveryData = { address: addr, coords };
      deliveryText.textContent = addr;
      
      const deliveryDetailsInput = modalEl.querySelector('#delivery-details');
      if (deliveryDetailsInput && notes) {
        deliveryDetailsInput.value = notes;
      }
      
      updateCost();
    }, { mode: 'pick' });
  };

  if (deliveryData?.coords) updateCost();

  modalEl.querySelector('#confirm-buy-btn').onclick = async () => {
    const nameInputs = Array.from(subformsContainer.querySelectorAll('.store-name-input'));
    const detailTextareas = Array.from(subformsContainer.querySelectorAll('.store-detail-textarea'));
    const deliveryDetailsInput = modalEl.querySelector('#delivery-details');
    const deliveryDetails = deliveryDetailsInput ? deliveryDetailsInput.value.trim() : '';

    const stopsList = [];
    for (let i = 0; i < stopsCount; i++) {
      const name = nameInputs[i] ? nameInputs[i].value.trim() : '';
      const details = detailTextareas[i] ? detailTextareas[i].value.trim() : '';
      stopsList.push({ store: name, items: details });
    }

    if (!selectedPaymentMethod) {
      showWarningModal('Por favor, selecciona un método de pago del envío (Efectivo o Transferencia)');
      return;
    }

    if (calculatedDistFee === 0) await updateCost();

    const extraStopsTotal = (stopsCount - 1) * extraStopFee;
    const subtotal = calculatedDistFee + purchaseFee + extraStopsTotal;
    
    let couponDiscount = 0;
    if (appliedCoupon) {
      if (appliedCoupon.type === 'free_delivery') {
        couponDiscount = calculatedDistFee;
      } else if (appliedCoupon.discountType === 'percentage') {
        couponDiscount = Math.floor(calculatedDistFee * (Number(appliedCoupon.value || 0) / 100));
      } else {
        couponDiscount = Number(appliedCoupon.value || 0);
      }
    }

    const rainSurcharge = getState().isRaining ? (getState().deliveryRainSurcharge || 300) : 0;
    const total = Math.max(subtotal + rainSurcharge + appFee - couponDiscount + selectedTip, 0);
    const stopsLabel = stopsCount === 1 ? '1 comercio' : `${stopsCount} comercios`;

    const packagedDetails = stopsList.map((stop, idx) => `🏪 **${idx + 1}. Comercio:** ${stop.store}\n📦 **Pedido:** ${stop.items}`).join('\n\n');

    showConfirm({
      title: '¿Confirmar compra?',
      message: `Se enviará un repartidor a realizar tu compra en <strong>${stopsLabel}</strong>.<br><br>Costo del servicio: <strong>${formatPrice(total)}</strong><br><br><small>* El valor de los productos se abona al repartidor al recibir el pedido.</small>`,
      onConfirm: async () => {
        try {
          const orderId = await createFavorOrder({
            type: 'compra',
            pickupAddress: stopsCount > 1 ? `Múltiples comercios (${stopsLabel})` : `Comercio: ${stopsList[0].store}`,
            pickupCoords: centerCoords,
            deliveryAddress: `${deliveryData.address} (Detalle: ${deliveryDetails})`,
            deliveryCoords: deliveryData.coords,
            details: packagedDetails,
            deliveryCost: calculatedDistFee + rainSurcharge,
            purchaseFee: purchaseFee,
            extraStopsFee: extraStopsTotal,
            stopsCount: stopsCount,
            appUsageFee: appFee,
            tip: selectedTip,
            couponCode: appliedCoupon ? appliedCoupon.code : null,
            couponDiscount: couponDiscount,
            total: total,
            paymentMethod: selectedPaymentMethod
          });
          closeModal();
          setTimeout(() => { location.hash = `#/pedido/${orderId}`; }, 150);
        } catch (e) {
          console.error('Error creating Compra favor:', e);
          showToast('Error al crear favor: ' + e.message, 'error');
        }
      }
    });
  };
}

export async function showGoCashForm() {
  const { geocodeAddress, getDistance, calculateDynamicFee } = await import('../utils/geo.js');
  const user = getState().user;
  const currentAddress = '';

  const modalEl = document.createElement('div');
  modalEl.style.cssText = 'padding: 20px 24px calc(16px + env(safe-area-inset-bottom, 16px)); background: var(--color-bg); display: flex; flex-direction: column; box-sizing: border-box;';
  modalEl.innerHTML = `
    <div style="display: flex; flex-direction: column;">
      
      <!-- Paso 1 Container -->
      <div id="gocash-step-1-container" style="display: flex; flex-direction: column; gap: 16px;">
        <div style="max-height: 50dvh; overflow-y: auto; display: flex; flex-direction: column; gap: 16px; padding-bottom:12px; scrollbar-width: none;">
          <!-- Type Selector Segmented Control -->
          <div style="display:flex; flex-direction:column; gap:8px; margin-top:4px;">
            <label style="font-size: 11px; font-weight: 900; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing:0.5px;">Operación</label>
            <div style="display: flex; background: var(--color-bg-secondary); padding: 4px; border-radius: 16px; border: 1.5px solid var(--color-border-light);">
              <button id="gocash-type-c2t" class="gocash-type-btn active" style="flex: 1; height: 44px; border-radius: 12px; border: none; font-size: 11px; font-weight: 850; cursor: pointer; transition: all 0.2s; background: var(--color-surface); color: var(--color-text-primary); box-shadow: var(--shadow-sm); display:flex; align-items:center; justify-content:center; text-align:center;">
                Doy Efectivo<br/>Recibo Transf.
              </button>
              <button id="gocash-type-t2c" class="gocash-type-btn" style="flex: 1; height: 44px; border-radius: 12px; border: none; font-size: 11px; font-weight: 850; cursor: pointer; transition: all 0.2s; background: transparent; color: var(--color-text-tertiary); display:flex; align-items:center; justify-content:center; text-align:center;">
                Doy Transf.<br/>Recibo Efectivo
              </button>
            </div>
          </div>

          <!-- Amount Input -->
          <div style="display:flex; flex-direction:column; gap:8px;">
            <label style="font-size: 11px; font-weight: 900; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing:0.5px;">Monto a Cambiar (Máx $70.000)</label>
            <div style="position:relative;">
              <span style="position:absolute; left:16px; top:50%; transform:translateY(-50%); font-size:18px; font-weight:900; color:var(--color-text-tertiary);">$</span>
              <input type="number" id="gocash-amount" placeholder="0" min="1" max="70000" style="width: 100%; height: 50px; border-radius: 14px; border: 1.5px solid var(--color-border-light); padding: 0 16px 0 35px; background: var(--color-surface); color:var(--color-text-primary); font-size: 18px; font-weight: 800; outline: none; transition: all 0.2s;" />
            </div>
          </div>

          <div style="display:flex; flex-direction:column; gap:8px;">
            <label style="font-size: 11px; font-weight: 900; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing:0.5px;">¿Dónde nos encontramos?</label>
            <button id="gocash-delivery-addr-btn" style="width: 100%; height: 60px; border-radius: 18px; border: 1.5px solid var(--color-border-light); padding: 0 16px; background: var(--color-surface); font-size: 14px; font-weight: 700; display:flex; align-items:center; gap:12px; text-align:left; color:var(--color-text-primary); cursor:pointer; transition:all 0.2s; box-shadow: var(--shadow-sm);">
               <div style="width:36px; height:36px; border-radius:12px; background:rgba(34, 197, 94, 0.1); color:#22c55e; display:flex; align-items:center; justify-content:center; flex-shrink:0;">${icon('home', 20)}</div>
               <span id="gocash-delivery-text" style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${currentAddress || 'Elegir destino...'}</span>
               ${icon('chevronRight', 16)}
            </button>
            <input type="text" id="gocash-delivery-details" value="${currentAddress ? (getState().addressNotes || '') : ''}" placeholder="Detalle: Nro, depto, timbre, local o ref (Obligatorio)" style="height:48px; border-radius:14px; border:1.5px solid var(--color-border-light); padding:0 14px; background:var(--color-surface); color:var(--color-text-primary); font-size:13.5px; font-weight:600; outline:none; transition:all 0.2s;" />
          </div>
        </div>

        <button type="button" id="gocash-step-1-next-btn" style="width: 100%; height: 56px; border-radius: 18px; background: var(--color-primary); color: white; border: none; font-weight: 900; font-size: 15px; cursor: pointer; text-transform: uppercase; letter-spacing: 0.05em; display: flex; align-items: center; justify-content: center; gap: 10px; margin-top: 8px; flex-shrink: 0; box-shadow: 0 8px 20px rgba(var(--color-primary-rgb),0.25);">
          Siguiente ${icon('chevronRight', 16)}
        </button>
      </div>

      <!-- Paso 2 Container -->
      <div id="gocash-step-2-container" style="display: none; flex-direction: column; gap: 16px;">
        <div style="max-height: 50dvh; overflow-y: auto; display: flex; flex-direction: column; gap: 16px; padding-bottom:12px; scrollbar-width: none;">
          <button type="button" id="gocash-step-2-back-btn" style="background:transparent; border:none; color:var(--color-primary); font-weight:800; cursor:pointer; display:flex; align-items:center; gap:4px; padding:8px 0; font-size:13px; outline:none; text-align:left; width:fit-content;">
            ${icon('chevronLeft', 16)} Volver a Paso 1
          </button>

          <!-- Benefits Container -->
          <div id="gocash-benefits-container"></div>

          <!-- Cost Preview -->
          <div id="gocash-cost-preview" style="background: var(--color-bg-secondary); padding: 16px; border-radius: 20px; display: none; flex-direction:column; gap:8px; border:1px solid var(--color-border-light); margin-top:auto;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span style="font-weight: 600; color: var(--color-text-secondary); font-size: 12px;">Envío estimado (desde centro)</span>
              <span id="gocash-dist-cost" style="font-size: 13px; font-weight: 700; color: var(--color-text-primary);">$ 0</span>
            </div>
            <div id="gocash-rain-row" style="display:none; justify-content:space-between; align-items:center;">
              <span style="font-weight: 600; color: #009EE3; font-size: 12px; display:flex; align-items:center; gap:4px;">
                ${icon('cloudRain', 14)} Recargo por Lluvia
              </span>
              <span id="gocash-rain-cost" style="font-size: 13px; font-weight: 700; color: #009EE3;">$ 0</span>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span style="font-weight: 600; color: var(--color-text-secondary); font-size: 12px;">Tarifa de Servicio (App)</span>
              <span id="gocash-app-fee" style="font-size: 13px; font-weight: 700; color: var(--color-text-primary);">$ 0</span>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:4px; padding-top:8px; border-top:1px dashed var(--color-border-light);">
              <span style="font-weight: 900; color: #4F46E5; font-size: 15px;">Total Envío Estimado</span>
              <span id="gocash-estimated-cost" style="font-size: 20px; font-weight: 950; color: #4F46E5;">$ 0</span>
            </div>
            <p style="font-size: 10px; color: var(--color-text-tertiary); margin-top: 8px; font-weight: 600; text-align: center; line-height:1.4;">
              * Se cobra únicamente el envío. El costo final se recalculará en base a la ubicación real del repartidor al aceptar.
            </p>
          </div>
        </div>

        <button id="confirm-gocash-btn" style="width: 100%; height: 56px; border-radius: 18px; background: #4F46E5; color: white; border: none; font-weight: 900; font-size: 15px; cursor: pointer; box-shadow: 0 8px 20px rgba(79,70,229, 0.25); text-transform: uppercase; letter-spacing: 0.05em; display: flex; align-items: center; justify-content: center; gap: 10px; margin-top: 8px; flex-shrink: 0;">
          ${icon('check', 20)} Solicitar Go Cash
        </button>
      </div>
    </div>
  `;

  showModal({
    title: 'Solicitar Go Cash',
    content: modalEl,
    height: 'auto',
    hideHeader: false,
    headerBackground: 'linear-gradient(135deg, #4F46E5 0%, #6366F1 100%)',
    headerTextColor: '#ffffff'
  });

  const btnC2t = modalEl.querySelector('#gocash-type-c2t');
  const btnT2c = modalEl.querySelector('#gocash-type-t2c');
  const amountInput = modalEl.querySelector('#gocash-amount');
  const deliveryBtn = modalEl.querySelector('#gocash-delivery-addr-btn');
  const deliveryText = modalEl.querySelector('#gocash-delivery-text');
  const previewBox = modalEl.querySelector('#gocash-cost-preview');
  const distCostEl = modalEl.querySelector('#gocash-dist-cost');
  const totalCostEl = modalEl.querySelector('#gocash-estimated-cost');

  let selectedType = 'cash_to_transfer'; // or 'transfer_to_cash'
  let deliveryData = currentAddress ? { address: currentAddress, coords: getState().deliveryCoords } : null;
  let calculatedFee = 0;
  let appFee = 0;
  let selectedTip = 0;
  let appliedCoupon = null;

  const benefitsContainer = modalEl.querySelector('#gocash-benefits-container');
  renderBenefitsSection(benefitsContainer, (tip, coupon) => {
    selectedTip = tip;
    appliedCoupon = coupon;
    updateCost();
  }, () => calculatedFee);

  btnC2t.onclick = () => {
    selectedType = 'cash_to_transfer';
    btnC2t.classList.add('active');
    btnC2t.style.background = 'var(--color-surface)';
    btnC2t.style.color = 'var(--color-text-primary)';
    btnC2t.style.boxShadow = 'var(--shadow-sm)';
    btnT2c.classList.remove('active');
    btnT2c.style.background = 'transparent';
    btnT2c.style.color = 'var(--color-text-tertiary)';
    btnT2c.style.boxShadow = 'none';
  };

  btnT2c.onclick = () => {
    selectedType = 'transfer_to_cash';
    btnT2c.classList.add('active');
    btnT2c.style.background = 'var(--color-surface)';
    btnT2c.style.color = 'var(--color-text-primary)';
    btnT2c.style.boxShadow = 'var(--shadow-sm)';
    btnC2t.classList.remove('active');
    btnC2t.style.background = 'transparent';
    btnC2t.style.color = 'var(--color-text-tertiary)';
    btnC2t.style.boxShadow = 'none';
  };

  const updateCost = async () => {
    if (deliveryData) {
      try {
        const centerCoords = { lat: -35.0811, lng: -57.5146 };
        const dist = await getDistance(centerCoords.lat, centerCoords.lng, deliveryData.coords.lat, deliveryData.coords.lng);
        calculatedFee = calculateDynamicFee(dist);

        const config = getState().servicesAppFeeConfig?.gocash || { type: 'percentage', value: 1.2 };
        if (config.type === 'fixed') {
          appFee = config.value;
        } else {
          appFee = Math.ceil((calculatedFee * (config.value / 100)) / 10) * 10;
        }

        let couponDiscount = 0;
        if (appliedCoupon) {
          if (appliedCoupon.type === 'free_delivery') {
            couponDiscount = calculatedFee;
          } else if (appliedCoupon.discountType === 'percentage') {
            couponDiscount = Math.floor(calculatedFee * (Number(appliedCoupon.value || 0) / 100));
          } else {
            couponDiscount = Number(appliedCoupon.value || 0);
          }
        }

        const rainSurcharge = getState().isRaining ? (getState().deliveryRainSurcharge || 300) : 0;
        const total = Math.max(calculatedFee + rainSurcharge + appFee - couponDiscount + selectedTip, 0);

        distCostEl.textContent = formatPrice(calculatedFee);
        
        const rainRow = modalEl.querySelector('#gocash-rain-row');
        const rainCostEl = modalEl.querySelector('#gocash-rain-cost');
        if (rainSurcharge > 0) {
          if (rainRow) rainRow.style.display = 'flex';
          if (rainCostEl) rainCostEl.textContent = `+ ${formatPrice(rainSurcharge)}`;
        } else {
          if (rainRow) rainRow.style.display = 'none';
        }

        const appFeeEl = modalEl.querySelector('#gocash-app-fee');
        if (appFeeEl) appFeeEl.textContent = formatPrice(appFee);

        let couponRow = previewBox.querySelector('.coupon-preview-row');
        const finalFeeRow = totalCostEl.parentElement;
        if (couponDiscount > 0) {
          if (!couponRow) {
            couponRow = document.createElement('div');
            couponRow.className = 'coupon-preview-row';
            couponRow.style.cssText = 'display:flex; justify-content:space-between; align-items:center; color:#a855f7; font-weight:700;';
            previewBox.insertBefore(couponRow, finalFeeRow);
          }
          couponRow.innerHTML = `<span>Descuento cupón (${appliedCoupon.code})</span><span>-${formatPrice(couponDiscount)}</span>`;
          couponRow.style.display = 'flex';
        } else if (couponRow) {
          couponRow.style.display = 'none';
        }

        let tipRow = previewBox.querySelector('.tip-preview-row');
        if (selectedTip > 0) {
          if (!tipRow) {
            tipRow = document.createElement('div');
            tipRow.className = 'tip-preview-row';
            tipRow.style.cssText = 'display:flex; justify-content:space-between; align-items:center; color:#10b981; font-weight:700;';
            previewBox.insertBefore(tipRow, finalFeeRow);
          }
          tipRow.innerHTML = `<span>Propina</span><span>+ ${formatPrice(selectedTip)}</span>`;
          tipRow.style.display = 'flex';
        } else if (tipRow) {
          tipRow.style.display = 'none';
        }

        totalCostEl.textContent = formatPrice(total);
        previewBox.style.display = 'flex';
      } catch (e) {}
    }
  };

  if (deliveryData) {
    updateCost();
  }

  deliveryBtn.onclick = () => {
    showAddressPrompt((addr, notes, coords) => {
      deliveryData = { address: addr, coords };
      deliveryText.textContent = addr;
      
      const deliveryDetailsInput = modalEl.querySelector('#gocash-delivery-details');
      if (deliveryDetailsInput && notes) {
        deliveryDetailsInput.value = notes;
      }
      
      updateCost();
    }, { mode: 'pick' });
  };

  modalEl.querySelector('#gocash-step-1-next-btn').onclick = () => {
    const amount = parseFloat(amountInput.value);
    if (isNaN(amount) || amount <= 0) {
      showToast('Ingresá un monto a cambiar válido', 'warning');
      return;
    }
    if (amount > 70000) {
      showToast('El monto máximo de cambio es $70.000', 'warning');
      return;
    }
    const deliveryDetailsInput = modalEl.querySelector('#gocash-delivery-details');
    const deliveryDetails = deliveryDetailsInput ? deliveryDetailsInput.value.trim() : '';

    if (!deliveryData) {
      showWarningModal('Por favor, selecciona la dirección de entrega (¿Dónde nos encontramos?)');
      return;
    }
    if (!deliveryDetails) {
      showWarningModal('Por favor, ingresa el detalle de la dirección de entrega (Nro, depto, ref...)');
      return;
    }
    if (!selectedType) {
      showWarningModal('Por favor, selecciona un tipo de operación para Go Cash');
      return;
    }

    modalEl.querySelector('#gocash-step-1-container').style.display = 'none';
    modalEl.querySelector('#gocash-step-2-container').style.display = 'flex';
  };

  modalEl.querySelector('#gocash-step-2-back-btn').onclick = () => {
    modalEl.querySelector('#gocash-step-1-container').style.display = 'flex';
    modalEl.querySelector('#gocash-step-2-container').style.display = 'none';
  };

  modalEl.querySelector('#confirm-gocash-btn').onclick = async () => {
    const amount = parseFloat(amountInput.value);
    const deliveryDetailsInput = modalEl.querySelector('#gocash-delivery-details');
    const deliveryDetails = deliveryDetailsInput ? deliveryDetailsInput.value.trim() : '';

    if (calculatedFee === 0) {
      await updateCost();
    }

    let couponDiscount = 0;
    if (appliedCoupon) {
      if (appliedCoupon.type === 'free_delivery') {
        couponDiscount = calculatedFee;
      } else if (appliedCoupon.discountType === 'percentage') {
        couponDiscount = Math.floor(calculatedFee * (Number(appliedCoupon.value || 0) / 100));
      } else {
        couponDiscount = Number(appliedCoupon.value || 0);
      }
    }

    const rainSurcharge = getState().isRaining ? (getState().deliveryRainSurcharge || 300) : 0;
    const total = Math.max(calculatedFee + rainSurcharge + appFee - couponDiscount + selectedTip, 0);
    const typeText = selectedType === 'cash_to_transfer' ? 'Efectivo a Transferencia' : 'Transferencia a Efectivo';
    
    showConfirm({
      title: '¿Confirmar Go Cash?',
      message: `Se enviará un repartidor para cambiar <strong>${formatPrice(amount)}</strong> (${typeText}).<br><br>Costo estimado del envío: <strong>${formatPrice(total)}</strong>`,
      onConfirm: async () => {
        try {
          const orderId = await createFavorOrder({
            type: 'gocash',
            pickupAddress: 'Ubicación del Repartidor',
            pickupCoords: { lat: -35.0811, lng: -57.5146 },
            deliveryAddress: `${deliveryData.address} (Detalle: ${deliveryDetails})`,
            deliveryCoords: deliveryData.coords,
            details: `Go Cash: Cambiar ${typeText} por valor de ${formatPrice(amount)}`,
            deliveryCost: calculatedFee + rainSurcharge,
            appUsageFee: appFee,
            tip: selectedTip,
            couponCode: appliedCoupon ? appliedCoupon.code : null,
            couponDiscount: couponDiscount,
            total: total,
            paymentMethod: selectedType,
            isGoCash: true,
            goCashAmount: amount,
            goCashType: selectedType
          });
          closeModal();
          setTimeout(() => {
            location.hash = `#/pedido/${orderId}`;
          }, 150);
        } catch (e) {
          console.error('Error creating Go Cash order:', e);
          showToast('Error al crear pedido Go Cash: ' + e.message, 'error');
        }
      }
    });
  };

  // Handle general info modal trigger
  const showGoFavoresGeneralModal = () => {
    showModal({
      title: '📦 ¿Cómo funcionan los Mandados?',
      height: 'auto',
      content: `
        <div style="padding: 20px; font-family: inherit; color: var(--color-text-primary); line-height: 1.5; font-size: 14px; display: flex; flex-direction: column; gap: 16px;">
          <p style="margin: 0; font-weight: 700;">GO! Mandados te permite solicitar cadetes y repartidores para realizar cualquier favor o encargo en el pueblo.</p>
          
          <div style="display: flex; flex-direction: column; gap: 12px; margin-top: 4px;">
            <div style="display: flex; gap: 10px; align-items: flex-start;">
              <div style="width: 20px; height: 20px; border-radius: 50%; background: var(--color-primary); color: white; display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-size: 11px; font-weight: 900; margin-top: 2px;">1</div>
              <div>
                <h4 style="font-size: 13px; font-weight: 800; margin: 0 0 2px; color: var(--color-text-primary);">Seleccioná tu tipo de favor</h4>
                <p style="font-size: 11.5px; color: var(--color-text-secondary); margin: 0; line-height: 1.35;">Encomienda (llevar/buscar algo), Mandado (ir a comprar) o GoCash (cambio de efectivo).</p>
              </div>
            </div>
            <div style="display: flex; gap: 10px; align-items: flex-start;">
              <div style="width: 20px; height: 20px; border-radius: 50%; background: var(--color-primary); color: white; display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-size: 11px; font-weight: 900; margin-top: 2px;">2</div>
              <div>
                <h4 style="font-size: 13px; font-weight: 800; margin: 0 0 2px; color: var(--color-text-primary);">Indicá los puntos en el mapa</h4>
                <p style="font-size: 11.5px; color: var(--color-text-secondary); margin: 0; line-height: 1.35;">Establecé dónde se realiza la recolección/compra y la dirección de entrega.</p>
              </div>
            </div>
            <div style="display: flex; gap: 10px; align-items: flex-start;">
              <div style="width: 20px; height: 20px; border-radius: 50%; background: var(--color-primary); color: white; display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-size: 11px; font-weight: 900; margin-top: 2px;">3</div>
              <div>
                <h4 style="font-size: 13px; font-weight: 800; margin: 0 0 2px; color: var(--color-text-primary);">Aceptación y Chat en vivo</h4>
                <p style="font-size: 11.5px; color: var(--color-text-secondary); margin: 0; line-height: 1.35;">El repartidor cotizará el mandado y podrás coordinar detalles por el chat interno en tiempo real.</p>
              </div>
            </div>
          </div>
          <button id="close-info-general-modal-btn" style="margin-top: 10px; width: 100%; height: 48px; border-radius: 12px; border: none; background: var(--color-primary); color: white; font-weight: 800; cursor: pointer; box-shadow: 0 4px 15px rgba(var(--color-primary-rgb), 0.2);">Entendido</button>
        </div>
      `,
      onOpen: () => {
        document.getElementById('close-info-general-modal-btn').onclick = () => closeModal();
      }
    });
  };
}

export function renderBenefitsSection(container, onUpdate, getDeliveryCost) {
  let selectedTip = 0;
  let appliedCoupon = null;

  function render() {
    container.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:12px; margin-bottom:16px;">
        <!-- Tip Pill -->
        <button type="button" id="favor-open-tip-btn" style="display:flex; align-items:center; justify-content:space-between; padding:14px 16px; background:var(--color-bg-card); border:1.5px solid ${selectedTip > 0 ? '#10b981' : 'var(--color-border-light)'}; border-radius:18px; cursor:pointer; transition:all 0.2s; outline:none; text-align:left; width:100%; box-sizing:border-box; box-shadow: var(--shadow-sm);">
          <div style="display:flex; align-items:center; gap:12px; min-width:0;">
            <div style="width:36px; height:36px; background:${selectedTip > 0 ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' : 'var(--color-surface-hover)'}; color:${selectedTip > 0 ? 'white' : 'var(--color-text-secondary)'}; border-radius:12px; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
              ${icon('dollarSign', 18)}
            </div>
            <div style="min-width:0;">
              <div style="font-size:12px; font-weight:900; color:var(--color-text-primary); text-transform:uppercase; letter-spacing:0.5px;">Propina al Repartidor</div>
              <div style="font-size:11px; color:var(--color-text-secondary); opacity:0.85; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-top:2px;">
                ${selectedTip > 0 ? `Propina aplicada: ${formatPrice(selectedTip)}` : 'Apoyar repartidor'}
              </div>
            </div>
          </div>
          <div style="font-size:12px; color:var(--color-text-secondary); display:flex; align-items:center; flex-shrink:0; margin-left:4px;">
            ${selectedTip > 0 ? icon('checkCircle', 16, '', '#10b981') : icon('chevronRight', 16)}
          </div>
        </button>

        <!-- Coupon Pill -->
        <button type="button" id="favor-open-coupon-btn" style="display:flex; align-items:center; justify-content:space-between; padding:14px 16px; background:var(--color-bg-card); border:1.5px solid ${appliedCoupon ? '#a855f7' : 'var(--color-border-light)'}; border-radius:18px; cursor:pointer; transition:all 0.2s; outline:none; text-align:left; width:100%; box-sizing:border-box; box-shadow: var(--shadow-sm);">
          <div style="display:flex; align-items:center; gap:12px; min-width:0;">
            <div style="width:36px; height:36px; background:${appliedCoupon ? 'linear-gradient(135deg, #a855f7 0%, #7e22ce 100%)' : 'var(--color-surface-hover)'}; color:${appliedCoupon ? 'white' : 'var(--color-text-secondary)'}; border-radius:12px; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
              ${icon('tag', 18)}
            </div>
            <div style="min-width:0;">
              <div style="font-size:12px; font-weight:900; color:var(--color-text-primary); text-transform:uppercase; letter-spacing:0.5px;">Cupón de Descuento</div>
              <div style="font-size:11px; color:var(--color-text-secondary); opacity:0.85; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-top:2px;">
                ${appliedCoupon ? `${appliedCoupon.code} - ${appliedCoupon.type === 'free_delivery' ? 'Envío Gratis' : (appliedCoupon.discountType === 'percentage' ? `${appliedCoupon.value}% OFF` : `$${appliedCoupon.value} OFF`)}` : 'Ingresar cupón'}
              </div>
            </div>
          </div>
          <div style="font-size:12px; color:var(--color-text-secondary); display:flex; align-items:center; flex-shrink:0; margin-left:4px;">
            ${appliedCoupon ? icon('checkCircle', 16, '', '#a855f7') : icon('chevronRight', 16)}
          </div>
        </button>
      </div>
    `;

    container.querySelector('#favor-open-tip-btn').onclick = () => {
      openTipModalLocal();
    };

    container.querySelector('#favor-open-coupon-btn').onclick = () => {
      openCouponModalLocal();
    };
  }

  function openTipModalLocal() {
    const presetTips = [300, 500, 700];
    const isCustom = selectedTip > 0 && !presetTips.includes(selectedTip);

    const modalContent = document.createElement('div');
    modalContent.style.cssText = 'padding: 24px 20px 40px; background: var(--color-bg); border-top-left-radius: 28px; border-top-right-radius: 28px; display: flex; flex-direction: column; gap: 20px;';

    modalContent.innerHTML = `
      <div style="width: 40px; height: 5px; background: var(--color-border-light); border-radius: 10px; margin: 0 auto 8px; flex-shrink: 0;"></div>
      
      <div style="text-align: center;">
        <div style="width: 56px; height: 56px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; border-radius: 18px; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; box-shadow: 0 8px 24px rgba(16, 185, 129, 0.25);">
          ${icon('dollarSign', 28)}
        </div>
        <h2 style="font-family: var(--font-display); font-size: 1.4rem; font-weight: 900; color: var(--color-text-primary); margin: 0 0 4px 0;">
          Propina al Repartidor
        </h2>
        <p style="font-size: 13px; color: var(--color-text-secondary); margin: 0; line-height: 1.5; padding: 0 10px;">
          El 100% de la propina va directamente al repartidor para apoyar su valioso servicio y dedicación.
        </p>
      </div>

      <div style="display:flex; flex-direction:column; gap:16px; margin-top:8px;">
        <div style="display:flex; gap:10px; flex-wrap:wrap; width:100%;">
          ${presetTips.map(amount => {
            const isActive = selectedTip === amount;
            return `
              <button type="button" class="tip-modal-preset-btn ${isActive ? 'active' : ''}" 
                      data-amount="${amount}"
                      style="flex:1; min-width:80px; height:46px; border-radius:12px; border:2px solid ${isActive ? 'var(--color-primary)' : 'var(--color-border-light)'}; background:${isActive ? 'rgba(var(--color-primary-rgb),0.1)' : 'var(--color-bg-secondary)'}; color:${isActive ? 'var(--color-primary)' : 'var(--color-text-primary)'}; font-size:14px; font-weight:800; cursor:pointer; transition:all 0.2s;">
                + ${formatPrice(amount)}
              </button>
            `;
          }).join('')}
        </div>

        <div style="display:flex; flex-direction:column; gap:8px;">
          <label style="font-size:11px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.05em;">Otro Monto (Opcional)</label>
          <div style="position:relative; display:flex; align-items:center;">
            <span style="position:absolute; left:16px; font-size:16px; font-weight:800; color:var(--color-text-secondary);">$</span>
            <input type="number" id="tip-modal-custom-input" 
                   min="1" 
                   placeholder="Ingresa otro valor" 
                   value="${isCustom ? selectedTip : ''}"
                   style="width:100%; height:50px; border-radius:14px; background:var(--color-bg-secondary); border:2px solid var(--color-border-light); padding:0 16px 0 32px; font-size:15px; font-weight:800; color:var(--color-text-primary); outline:none; transition:all 0.2s;" />
          </div>
        </div>
      </div>

      <div style="display: flex; gap: 12px; margin-top: 12px;">
        ${selectedTip > 0 ? `
          <button type="button" id="tip-modal-clear-btn" class="btn btn-ghost" style="height: 52px; flex: 1; border-radius: 14px; font-weight: 800; color: var(--color-danger); background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.15); display: flex; align-items: center; justify-content: center; gap: 8px; padding:0;">
            ${icon('trash', 16)} Eliminar
          </button>
        ` : ''}
        <button type="button" id="tip-modal-confirm-btn" class="btn btn-primary" style="height: 52px; flex: 2; border-radius: 14px; font-weight: 900; font-size: 14px; display: flex; align-items: center; justify-content: center; gap: 8px;">
          ${icon('check', 16)} APLICAR PROPINA
        </button>
      </div>
    `;

    const tipModal = showModal({
      title: '',
      hideHeader: true,
      height: 'auto',
      content: modalContent
    });

    const customInput = modalContent.querySelector('#tip-modal-custom-input');

    modalContent.querySelectorAll('.tip-modal-preset-btn').forEach(btn => {
      btn.onclick = () => {
        modalContent.querySelectorAll('.tip-modal-preset-btn').forEach(b => {
          b.classList.remove('active');
          b.style.borderColor = 'var(--color-border-light)';
          b.style.backgroundColor = 'var(--color-bg-secondary)';
          b.style.color = 'var(--color-text-primary)';
        });
        btn.classList.add('active');
        btn.style.borderColor = 'var(--color-primary)';
        btn.style.backgroundColor = 'rgba(var(--color-primary-rgb),0.1)';
        btn.style.color = 'var(--color-primary)';
        
        if (customInput) customInput.value = '';
      };
    });

    if (customInput) {
      customInput.oninput = () => {
        modalContent.querySelectorAll('.tip-modal-preset-btn').forEach(b => {
          b.classList.remove('active');
          b.style.borderColor = 'var(--color-border-light)';
          b.style.backgroundColor = 'var(--color-bg-secondary)';
          b.style.color = 'var(--color-text-primary)';
        });
      };
    }

    const confirmBtn = modalContent.querySelector('#tip-modal-confirm-btn');
    confirmBtn.onclick = () => {
      let finalAmount = 0;
      const activePreset = modalContent.querySelector('.tip-modal-preset-btn.active');
      
      if (activePreset) {
        finalAmount = parseInt(activePreset.dataset.amount, 10);
      } else if (customInput) {
        const valStr = customInput.value.trim();
        if (valStr) {
          finalAmount = parseInt(valStr, 10);
          if (isNaN(finalAmount) || finalAmount <= 0) {
            showToast('Por favor ingresá un monto de propina válido.', 'warning');
            return;
          }
        }
      }

      selectedTip = finalAmount;
      if (finalAmount > 0) {
        showToast(`Propina de ${formatPrice(finalAmount)} agregada.`, 'success');
      } else {
        showToast('Propina eliminada.', 'info');
      }
      tipModal.close();
      render();
      onUpdate(selectedTip, appliedCoupon);
    };

    const clearBtn = modalContent.querySelector('#tip-modal-clear-btn');
    if (clearBtn) {
      clearBtn.onclick = () => {
        selectedTip = 0;
        showToast('Propina eliminada.', 'info');
        tipModal.close();
        render();
        onUpdate(selectedTip, appliedCoupon);
      };
    }
  }

  function openCouponModalLocal() {
    const modalContent = document.createElement('div');
    modalContent.style.cssText = 'padding: 24px 20px 40px; background: var(--color-bg); border-top-left-radius: 28px; border-top-right-radius: 28px; display: flex; flex-direction: column; gap: 20px;';

    modalContent.innerHTML = `
      <div style="width: 40px; height: 5px; background: var(--color-border-light); border-radius: 10px; margin: 0 auto 8px; flex-shrink: 0;"></div>
      
      <div style="text-align: center;">
        <div style="width: 56px; height: 56px; background: linear-gradient(135deg, #a855f7 0%, #7e22ce 100%); color: white; border-radius: 18px; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; box-shadow: 0 8px 24px rgba(168, 85, 247, 0.35);">
          ${icon('tag', 26)}
        </div>
        <h2 style="font-family: var(--font-display); font-size: 1.4rem; font-weight: 900; color: var(--color-text-primary); margin: 0 0 4px 0;">
          Ingresar Cupón
        </h2>
        <p style="font-size: 13px; color: var(--color-text-secondary); margin: 0; line-height: 1.5; padding: 0 10px;">
          Ingresá un código promocional para obtener envíos gratis o descuentos.
        </p>
      </div>

      ${appliedCoupon ? `
        <div style="background: rgba(168, 85, 247, 0.05); border: 1.5px solid rgba(168, 85, 247, 0.2); border-radius: 16px; padding: 14px; display: flex; align-items: center; justify-content: space-between;">
          <div>
            <div style="font-size: 11px; font-weight: 900; color: #a855f7; text-transform: uppercase; letter-spacing: 0.5px;">CUPÓN ACTIVO</div>
            <div style="font-size: 14px; font-weight: 800; color: var(--color-text-primary); margin-top: 2px;">
              ${appliedCoupon.code} <span style="font-size: 12px; font-weight: 600; color: var(--color-text-secondary); opacity: 0.85;">(${appliedCoupon.type === 'free_delivery' ? 'Envío Gratis' : `${appliedCoupon.value}% OFF`})</span>
            </div>
          </div>
          <div style="width: 24px; height: 24px; color: #a855f7; display: flex; align-items: center; justify-content: center;">
            ${icon('checkCircle', 18)}
          </div>
        </div>
      ` : ''}

      <div style="display:flex; flex-direction:column; gap:8px;">
        <label style="font-size:11px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.05em;">Código del Cupón</label>
        <div style="position:relative; display:flex; align-items:center; width:100%;">
          <input type="text" id="coupon-modal-input" 
                 placeholder="Ej. GODEL-XYZ" 
                 value="${appliedCoupon ? appliedCoupon.code : ''}"
                 style="width:100%; height:50px; border-radius:14px; background:var(--color-bg-secondary); border:2px solid var(--color-border-light); padding:0 16px; font-size:15px; font-weight:800; color:var(--color-text-primary); outline:none; transition:all 0.2s; text-transform: uppercase;" />
        </div>
        <div id="coupon-modal-error" style="display:none; color:var(--color-danger); font-size:12px; font-weight:700; padding-left:4px; margin-top: 4px;"></div>
      </div>

      <div style="display: flex; gap: 12px; margin-top: 12px;">
        ${appliedCoupon ? `
          <button type="button" id="coupon-modal-clear-btn" class="btn btn-ghost" style="height: 52px; flex: 1; border-radius: 14px; font-weight: 800; color: var(--color-danger); background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.15); display: flex; align-items: center; justify-content: center; gap: 8px; padding: 0;">
            ${icon('trash', 16)} Quitar
          </button>
        ` : ''}
        <button type="button" id="coupon-modal-confirm-btn" class="btn btn-primary" style="height: 52px; flex: 2; border-radius: 14px; font-weight: 900; font-size: 14px; display: flex; align-items: center; justify-content: center; gap: 8px; background: linear-gradient(135deg, #a855f7 0%, #7e22ce 100%); border: none; box-shadow: 0 8px 20px rgba(168, 85, 247, 0.25);">
          ${icon('check', 16)} APLICAR CUPÓN
        </button>
      </div>
    `;

    const couponModal = showModal({
      title: '',
      hideHeader: true,
      height: 'auto',
      content: modalContent
    });

    const input = modalContent.querySelector('#coupon-modal-input');
    const errorMsg = modalContent.querySelector('#coupon-modal-error');
    const confirmBtn = modalContent.querySelector('#coupon-modal-confirm-btn');
    const clearBtn = modalContent.querySelector('#coupon-modal-clear-btn');

    if (input) {
      input.oninput = () => {
        if (errorMsg) errorMsg.style.display = 'none';
        input.value = input.value.toUpperCase();
      };
    }

    confirmBtn.onclick = async () => {
      const valStr = input.value.trim().toUpperCase();
      if (!valStr) {
        errorMsg.textContent = 'Por favor ingresá un código de cupón.';
        errorMsg.style.display = 'block';
        return;
      }

      confirmBtn.disabled = true;
      confirmBtn.innerHTML = `${icon('loader', 16, 'animate-spin')} VALIDANDO...`;
      if (clearBtn) clearBtn.disabled = true;
      if (input) input.disabled = true;

      try {
        if (valStr === 'BIENVENIDA') {
          throw new Error('Este cupón es exclusivo para tu primer pedido a un comercio (no aplica en mandados).');
        }

        const couponRef = doc(db, 'coupons', valStr);
        const couponSnap = await getDoc(couponRef);

        if (!couponSnap.exists()) {
          throw new Error('El cupón ingresado no existe.');
        }

        const cData = couponSnap.data();

        if (cData.active !== true) {
          throw new Error('El cupón ingresado no está activo.');
        }

        if (typeof cData.remaining === 'number' && cData.remaining <= 0) {
          throw new Error('Este cupón ya no tiene usos disponibles.');
        }

        if (cData.expirationDate) {
          const expDate = new Date(cData.expirationDate + 'T23:59:59-03:00');
          if (Date.now() > expDate.getTime()) {
            throw new Error('Este cupón ha expirado.');
          }
        }

        if (cData.ownerId && cData.ownerId !== 'admin') {
          throw new Error('Este cupón es de un comercio específico y no aplica a envíos.');
        }



        appliedCoupon = {
          code: valStr,
          ...cData
        };

        showToast('Cupón aplicado con éxito', 'success');
        couponModal.close();
        render();
        onUpdate(selectedTip, appliedCoupon);
      } catch (err) {
        errorMsg.textContent = err.message;
        errorMsg.style.display = 'block';
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = `${icon('check', 16)} APLICAR CUPÓN`;
        if (clearBtn) clearBtn.disabled = false;
        if (input) input.disabled = false;
      }
    };

    if (clearBtn) {
      clearBtn.onclick = () => {
        appliedCoupon = null;
        showToast('Cupón removido', 'info');
        couponModal.close();
        render();
        onUpdate(selectedTip, appliedCoupon);
      };
    }
  }

  render();
}

export async function showPagoServiciosForm() {
  const { getDistance, calculateDynamicFee } = await import('../utils/geo.js');
  const modalEl = document.createElement('div');
  modalEl.style.cssText = 'padding: 20px 24px calc(16px + env(safe-area-inset-bottom, 16px)); background: var(--color-bg); display: flex; flex-direction: column; box-sizing: border-box; height: 100%;';

  let currentAddress = '';
  let deliveryData = null;
  let selectedService = null; 
  let receiptDeliveryType = 'digital'; 
  let calculatedDistFee = 0;
  let baseFee = getState().servicePaymentErrandFee !== undefined ? getState().servicePaymentErrandFee : 2000;
  let appFee = 0;
  let selectedTip = 0;
  let appliedCoupon = null;

  modalEl.innerHTML = `
    <style>
      .ps-service-grid-premium {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 12px;
      }
      .ps-service-btn-premium {
        height: 58px;
        border-radius: 16px;
        border: 1.5px solid var(--color-border-light);
        background: var(--color-surface);
        font-size: 13.5px;
        font-weight: 800;
        color: var(--color-text-primary);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        transition: all 0.22s cubic-bezier(0.4, 0, 0.2, 1);
        box-shadow: var(--shadow-sm);
      }
      .ps-service-btn-premium:hover {
        transform: translateY(-1.5px);
        box-shadow: var(--shadow-md);
        border-color: rgba(217, 119, 6, 0.35);
      }
      .ps-service-btn-premium:active {
        transform: translateY(0) scale(0.97);
      }
      .ps-service-btn-premium.active {
        background: linear-gradient(135deg, #F59E0B 0%, #D97706 100%) !important;
        border-color: transparent !important;
        color: white !important;
        box-shadow: 0 6px 20px rgba(217, 119, 6, 0.38) !important;
        transform: scale(1.02) translateY(-1px);
      }
      .ps-textarea-premium {
        width:100%;
        height:94px;
        border-radius:16px;
        border:1.5px solid var(--color-border-light);
        padding:14px;
        background:var(--color-surface);
        color:var(--color-text-primary);
        font-size:13.5px;
        font-weight:600;
        outline:none;
        font-family:inherit;
        resize:none;
        transition:all 0.22s cubic-bezier(0.4, 0, 0.2, 1);
        box-shadow: inset 0 2px 4px rgba(0,0,0,0.015);
      }
      .ps-textarea-premium:focus {
        border-color: #D97706 !important;
        box-shadow: 0 0 0 3px rgba(217, 119, 6, 0.18), inset 0 2px 4px rgba(0,0,0,0.015) !important;
      }
      .ps-del-btn-premium {
        flex: 1;
        height: 44px;
        border-radius: 12px;
        border: none;
        font-size: 13.5px;
        font-weight: 900;
        cursor: pointer;
        transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        background: transparent;
        color: var(--color-text-tertiary);
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
      }
      .ps-del-btn-premium.active-digital {
        background: #10B981 !important;
        color: white !important;
        box-shadow: 0 4px 14px rgba(16, 185, 129, 0.3) !important;
      }
      .ps-del-btn-premium.active-physical {
        background: var(--color-primary) !important;
        color: white !important;
        box-shadow: 0 4px 14px rgba(var(--color-primary-rgb), 0.3) !important;
      }
      .ps-cost-card-premium {
        background: var(--color-bg-secondary);
        padding: 18px;
        border-radius: 24px;
        display: none;
        flex-direction: column;
        gap: 10px;
        border: 1.5px solid var(--color-border-light);
        margin-top: auto;
        box-shadow: var(--shadow-sm);
      }
    </style>

    <div style="display: flex; flex-direction: column; height: 100%; flex: 1;">
      <!-- STEP 1 CONTAINER -->
      <div id="ps-step-1-container" style="display: flex; flex-direction: column; flex: 1; height: 100%; justify-content: space-between; gap: 16px;">
        <div style="display: flex; flex-direction: column; gap: 16px; flex: 1; overflow-y: auto; scrollbar-width: none; padding-bottom: 4px;">
          
          <!-- Service Chooser List -->
          <div style="display:flex; flex-direction:column; gap:8px; margin-top:4px;">
            <label style="font-size: 11px; font-weight: 900; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing:0.5px;">Selecciona el Servicio a Pagar</label>
            <div class="ps-service-grid-premium" id="ps-service-grid">
              <button class="ps-service-btn-premium" data-service="Cyber">
                ${icon('monitor', 20)} Cyber
              </button>
              <button class="ps-service-btn-premium" data-service="ABSA">
                ${icon('droplet', 20)} ABSA
              </button>
              <button class="ps-service-btn-premium" data-service="Canal 4">
                ${icon('tv', 20)} Canal 4
              </button>
              <button class="ps-service-btn-premium" data-service="Rapipago">
                ${icon('creditCard', 20)} Rapipago
              </button>
              <button class="ps-service-btn-premium" data-service="PagoFácil">
                ${icon('zap', 20)} PagoFácil
              </button>
              <button class="ps-service-btn-premium" data-service="Otro">
                ${icon('plus', 20)} Otro
              </button>
            </div>
          </div>

          <!-- Detail Input -->
          <div style="display:flex; flex-direction:column; gap:8px;">
            <label style="font-size: 11px; font-weight: 900; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing:0.5px;">Servicios y Detalles a Pagar</label>
            <textarea id="ps-details-input" class="ps-textarea-premium" placeholder="Ej: Pagar factura de internet, código de barras: 1234567890 o detalles particulares del delivery"></textarea>
          </div>

          <!-- Receipt Delivery Selector -->
          <div style="display:flex; flex-direction:column; gap:10px;">
            <label style="font-size: 11px; font-weight: 900; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing:0.5px;">Forma de Recibir el Comprobante</label>
            <div style="display: flex; background: var(--color-bg-secondary); padding: 4px; border-radius: 16px; border: 1.5px solid var(--color-border-light);">
              <button type="button" id="ps-delivery-digital" class="ps-del-btn-premium active-digital">
                ${icon('image', 18)} Foto Digital
              </button>
              <button type="button" id="ps-delivery-physical" class="ps-del-btn-premium">
                ${icon('mapPin', 18)} Físico
              </button>
            </div>
            <!-- Helper subtexts -->
            <div id="ps-del-subtext-digital" style="font-size: 11px; color: var(--color-success); font-weight: 800; text-align: center; margin-top: 2px; display: block; line-height: 1.4;">
              🟢 Sin costo adicional (Recibís foto del ticket por chat)
            </div>
            <div id="ps-del-subtext-physical" style="font-size: 11px; color: var(--color-primary); font-weight: 800; text-align: center; margin-top: 2px; display: none; line-height: 1.4;">
              🚚 Envío a Domicilio (+ Envío por Distancia del Viaje)
            </div>
          </div>

          <!-- Physical Delivery Address Details -->
          <div id="ps-address-section" style="display:none; flex-direction:column; gap:8px;">
            <label style="font-size: 11px; font-weight: 900; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing:0.5px;">Tu Dirección de Entrega</label>
            <button id="ps-delivery-addr-btn" style="width: 100%; height: 60px; border-radius: 18px; border: 1.5px solid var(--color-border-light); padding: 0 16px; background: var(--color-surface); font-size: 14px; font-weight: 700; display:flex; align-items:center; gap:12px; text-align:left; color:var(--color-text-primary); cursor:pointer; transition:all 0.2s; box-shadow: var(--shadow-sm);">
               <div style="width:36px; height:36px; border-radius:12px; background:rgba(245, 158, 11, 0.1); color:#D97706; display:flex; align-items:center; justify-content:center; flex-shrink:0;">${icon('home', 20)}</div>
               <span id="ps-delivery-text" style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${currentAddress || 'Elegir destino...'}</span>
               ${icon('chevronRight', 16)}
            </button>
            <input type="text" id="ps-delivery-details" value="${currentAddress ? (getState().addressNotes || '') : ''}" placeholder="Detalle: Nro, depto, timbre, local o ref (Obligatorio)" style="height:48px; border-radius:14px; border:1.5px solid var(--color-border-light); padding:0 14px; background:var(--color-surface); color:var(--color-text-primary); font-size:13.5px; font-weight:600; outline:none; transition:all 0.2s;" />
          </div>
        </div>

        <button type="button" id="ps-step-1-next-btn" style="width: 100%; height: 56px; border-radius: 18px; background: var(--color-primary); color: white; border: none; font-weight: 900; font-size: 15px; cursor: pointer; text-transform: uppercase; letter-spacing: 0.05em; display: flex; align-items: center; justify-content: center; gap: 10px; flex-shrink: 0; box-shadow: 0 8px 20px rgba(var(--color-primary-rgb),0.25);">
          Siguiente ${icon('chevronRight', 16)}
        </button>
      </div>

      <!-- STEP 2 CONTAINER -->
      <div id="ps-step-2-container" style="display: none; flex-direction: column; flex: 1; height: 100%; justify-content: space-between; gap: 16px;">
        <div style="display: flex; flex-direction: column; gap: 16px; flex: 1; overflow-y: auto; scrollbar-width: none; padding-bottom: 4px;">
          <button type="button" id="ps-step-2-back-btn" style="background:transparent; border:none; color:var(--color-primary); font-weight:800; cursor:pointer; display:flex; align-items:center; gap:4px; padding:8px 0; font-size:13px; outline:none; text-align:left; width:fit-content; margin-bottom: 10px;">
            ${icon('chevronLeft', 16)} Volver a Paso 1
          </button>

          <!-- Benefits Container -->
          <div id="ps-benefits-container"></div>

          <!-- Cost Preview -->
          <div id="ps-cost-preview" class="ps-cost-card-premium">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span style="font-weight: 600; color: var(--color-text-secondary); font-size: 12px;">Base Trámite Pago de Servicios</span>
              <span id="ps-base-cost" style="font-size: 13px; font-weight: 700; color: var(--color-text-primary);">$ 0</span>
            </div>
            <div id="ps-dist-row" style="display:none; justify-content:space-between; align-items:center;">
              <span style="font-weight: 600; color: var(--color-text-secondary); font-size: 12px;">Envío de Comprobante (Regreso)</span>
              <span id="ps-dist-cost" style="font-size: 13px; font-weight: 700; color: var(--color-text-primary);">$ 0</span>
            </div>
            <div id="ps-rain-row" style="display:none; justify-content:space-between; align-items:center;">
              <span style="font-weight: 600; color: #009EE3; font-size: 12px; display:flex; align-items:center; gap:4px;">
                ${icon('cloudRain', 14)} Recargo por Lluvia
              </span>
              <span id="ps-rain-cost" style="font-size: 13px; font-weight: 700; color: #009EE3;">$ 0</span>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span style="font-weight: 600; color: var(--color-text-secondary); font-size: 12px;">Tarifa de Servicio (App)</span>
              <span id="ps-app-fee" style="font-size: 13px; font-weight: 700; color: var(--color-text-primary);">$ 0</span>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:4px; padding-top:8px; border-top:1px dashed var(--color-border-light);">
              <span style="font-weight: 900; color: var(--color-primary); font-size: 15px;">Total Trámite Estimado</span>
              <span id="ps-estimated-cost" style="font-size: 20px; font-weight: 950; color: var(--color-primary);">$ 0</span>
            </div>
            <p style="font-size: 10px; color: var(--color-text-tertiary); margin-top: 8px; font-weight: 600; text-align: center; line-height:1.4;">
              * El dinero de la factura a pagar se coordina y se abona al repartidor al momento de iniciar la gestión o por transferencia.
            </p>
          </div>
        </div>

        <button id="confirm-ps-btn" style="width: 100%; height: 56px; border-radius: 18px; background: var(--color-primary); color: white; border: none; font-weight: 900; font-size: 15px; cursor: pointer; box-shadow: 0 8px 20px rgba(var(--color-primary-rgb), 0.25); text-transform: uppercase; letter-spacing: 0.05em; display: flex; align-items: center; justify-content: center; gap: 10px; flex-shrink: 0;">
          ${icon('check', 20)} Solicitar Pago de Servicios
        </button>
      </div>
    </div>
  `;

  showModal({
    title: 'Solicitar Pago de Servicios',
    content: modalEl,
    height: '94dvh',
    hideHeader: false,
    headerBackground: 'linear-gradient(135deg, #F59E0B 0%, #D97706 100%)',
    headerTextColor: '#ffffff'
  });

  const serviceGrid = modalEl.querySelector('#ps-service-grid');
  const detailsInput = modalEl.querySelector('#ps-details-input');
  const btnDigital = modalEl.querySelector('#ps-delivery-digital');
  const btnPhysical = modalEl.querySelector('#ps-delivery-physical');
  const subtextDigital = modalEl.querySelector('#ps-del-subtext-digital');
  const subtextPhysical = modalEl.querySelector('#ps-del-subtext-physical');
  const addressSection = modalEl.querySelector('#ps-address-section');
  const deliveryBtn = modalEl.querySelector('#ps-delivery-addr-btn');
  const deliveryText = modalEl.querySelector('#ps-delivery-text');
  const deliveryDetailsInput = modalEl.querySelector('#ps-delivery-details');

  const previewBox = modalEl.querySelector('#ps-cost-preview');
  const distRow = modalEl.querySelector('#ps-dist-row');
  const baseCostEl = modalEl.querySelector('#ps-base-cost');
  const distCostEl = modalEl.querySelector('#ps-dist-cost');
  const appFeeEl = modalEl.querySelector('#ps-app-fee');
  const totalCostEl = modalEl.querySelector('#ps-estimated-cost');

  // Handle service button selection
  serviceGrid.querySelectorAll('.ps-service-btn-premium').forEach(btn => {
    btn.onclick = () => {
      serviceGrid.querySelectorAll('.ps-service-btn-premium').forEach(b => {
        b.classList.remove('active');
      });
      btn.classList.add('active');
      selectedService = btn.dataset.service;
    };
  });

  // Toggle receipt delivery methods
  btnDigital.onclick = () => {
    receiptDeliveryType = 'digital';
    btnDigital.className = 'ps-del-btn-premium active-digital';
    btnPhysical.className = 'ps-del-btn-premium';
    subtextDigital.style.display = 'block';
    subtextPhysical.style.display = 'none';
    addressSection.style.display = 'none';
    
    updateCost();
  };

  btnPhysical.onclick = () => {
    receiptDeliveryType = 'physical';
    btnPhysical.className = 'ps-del-btn-premium active-physical';
    btnDigital.className = 'ps-del-btn-premium';
    subtextDigital.style.display = 'none';
    subtextPhysical.style.display = 'block';
    addressSection.style.display = 'flex';
    
    updateCost();
  };

  const updateCost = async () => {
    try {
      baseCostEl.textContent = formatPrice(baseFee);

      let logisticsCost = baseFee;

      if (receiptDeliveryType === 'physical' && deliveryData) {
        const centerCoords = { lat: -35.0811, lng: -57.5146 };
        const dist = await getDistance(centerCoords.lat, centerCoords.lng, deliveryData.coords.lat, deliveryData.coords.lng);
        calculatedDistFee = calculateDynamicFee(dist);
        distRow.style.display = 'flex';
        distCostEl.textContent = formatPrice(calculatedDistFee);
        logisticsCost += calculatedDistFee;
      } else {
        distRow.style.display = 'none';
        calculatedDistFee = 0;
      }

      // App fee configuration (calculates on shipping logistics value)
      const config = getState().servicesAppFeeConfig?.gofavor || { type: 'percentage', value: 1.2 };
      if (config.type === 'fixed') {
        appFee = config.value;
      } else {
        appFee = Math.ceil((logisticsCost * (config.value / 100)) / 10) * 10;
      }

      let couponDiscount = 0;
      if (appliedCoupon) {
        if (appliedCoupon.type === 'free_delivery') {
          couponDiscount = calculatedDistFee;
        } else if (appliedCoupon.discountType === 'percentage') {
          couponDiscount = Math.floor(calculatedDistFee * (Number(appliedCoupon.value || 0) / 100));
        } else {
          couponDiscount = Number(appliedCoupon.value || 0);
        }
      }

      const rainSurcharge = getState().isRaining ? (getState().deliveryRainSurcharge || 300) : 0;
      const total = Math.max(logisticsCost + rainSurcharge + appFee - couponDiscount + selectedTip, 0);

      const rainRow = modalEl.querySelector('#ps-rain-row');
      const rainCostEl = modalEl.querySelector('#ps-rain-cost');
      if (rainSurcharge > 0) {
        if (rainRow) rainRow.style.display = 'flex';
        if (rainCostEl) rainCostEl.textContent = `+ ${formatPrice(rainSurcharge)}`;
      } else {
        if (rainRow) rainRow.style.display = 'none';
      }

      appFeeEl.textContent = formatPrice(appFee);
      totalCostEl.textContent = formatPrice(total);
      previewBox.style.display = 'flex';
    } catch (err) {
      console.error('Error updating cost in Pago de Servicios:', err);
    }
  };

  // Address picking trigger
  deliveryBtn.onclick = () => {
    showAddressPrompt((addr, notes, coords) => {
      deliveryData = { address: addr, coords };
      deliveryText.textContent = addr;
      if (deliveryDetailsInput) {
        deliveryDetailsInput.value = notes || '';
      }
      updateCost();
    }, { mode: 'pick' });
  };

  const benefitsContainer = modalEl.querySelector('#ps-benefits-container');
  renderBenefitsSection(benefitsContainer, (tip, coupon) => {
    selectedTip = tip;
    appliedCoupon = coupon;
    updateCost();
  }, () => calculatedDistFee);

  // Next step click trigger
  modalEl.querySelector('#ps-step-1-next-btn').onclick = () => {
    if (!selectedService) {
      showToast('Por favor selecciona el servicio que deseas pagar.', 'warning');
      return;
    }
    const detailsText = detailsInput.value.trim();
    if (!detailsText) {
      showToast('Por favor describe los detalles de la factura a pagar.', 'warning');
      return;
    }

    if (receiptDeliveryType === 'physical') {
      if (!deliveryData) {
        showToast('Por favor selecciona una dirección de entrega.', 'warning');
        return;
      }
      const detailsVal = deliveryDetailsInput.value.trim();
      if (!detailsVal) {
        showToast('El detalle de dirección es obligatorio.', 'warning');
        return;
      }
    }

    const proceedToStep2 = () => {
      modalEl.querySelector('#ps-step-1-container').style.display = 'none';
      modalEl.querySelector('#ps-step-2-container').style.display = 'flex';
      updateCost();
    };

    if (receiptDeliveryType === 'digital') {
      showConfirm({
        title: '⚠️ Advertencia Importante',
        message: 'Al seleccionar <strong>Foto Digital</strong>, el pago debe ser realizado <strong>sí o sí mediante transferencia bancaria</strong>.<br><br>Se te solicitará enviar una foto del comprobante de transferencia por el chat del pedido antes de que el repartidor realice el pago de tu servicio.',
        confirmText: 'Aceptar',
        cancelText: 'Cancelar',
        onConfirm: () => {
          proceedToStep2();
        }
      });
    } else {
      proceedToStep2();
    }
  };

  modalEl.querySelector('#ps-step-2-back-btn').onclick = () => {
    modalEl.querySelector('#ps-step-1-container').style.display = 'flex';
    modalEl.querySelector('#ps-step-2-container').style.display = 'none';
  };

  modalEl.querySelector('#confirm-ps-btn').onclick = async () => {
    const detailsText = detailsInput.value.trim();
    const deliveryDetails = deliveryDetailsInput ? deliveryDetailsInput.value.trim() : '';

    if (receiptDeliveryType === 'physical' && !deliveryData) {
      showToast('Por favor selecciona una dirección de entrega.', 'warning');
      return;
    }

    let couponDiscount = 0;
    if (appliedCoupon) {
      if (appliedCoupon.type === 'free_delivery') {
        couponDiscount = calculatedDistFee;
      } else if (appliedCoupon.discountType === 'percentage') {
        couponDiscount = Math.floor(calculatedDistFee * (Number(appliedCoupon.value || 0) / 100));
      } else {
        couponDiscount = Number(appliedCoupon.value || 0);
      }
    }

    const rainSurcharge = getState().isRaining ? (getState().deliveryRainSurcharge || 300) : 0;
    const logisticsCost = baseFee + calculatedDistFee;
    const total = Math.max(logisticsCost + rainSurcharge + appFee - couponDiscount + selectedTip, 0);

    const deliveryTypeLabel = receiptDeliveryType === 'physical' ? 'Comprobante Físico a Domicilio' : 'Foto Digital por Chat';
    const detailPayload = `🏢 **Servicio:** ${selectedService}\n📄 **Facturas & Código:** ${detailsText}\n📩 **Entrega Comprobante:** ${deliveryTypeLabel}`;

    const pickupAddressVal = `Pago Fácil Centro (Trámite de Pago)`;
    const deliveryAddressVal = receiptDeliveryType === 'physical'
      ? `${deliveryData.address} (Detalle: ${deliveryDetails})`
      : 'Envío Digital (Sin Dirección)';

    const deliveryCoordsVal = receiptDeliveryType === 'physical'
      ? deliveryData.coords
      : { lat: -35.0811, lng: -57.5146 };

    showConfirm({
      title: '¿Confirmar Trámite?',
      message: `Se enviará un repartidor a pagar tu factura de <strong>${selectedService}</strong>.<br><br>Costo del servicio: <strong>${formatPrice(total)}</strong>`,
      onConfirm: async () => {
        try {
          const orderId = await createFavorOrder({
            type: 'pagodeservicios',
            pickupAddress: pickupAddressVal,
            pickupCoords: { lat: -35.0811, lng: -57.5146 },
            deliveryAddress: deliveryAddressVal,
            deliveryCoords: deliveryCoordsVal,
            details: detailPayload,
            deliveryCost: calculatedDistFee + rainSurcharge,
            purchaseFee: baseFee,
            appUsageFee: appFee,
            tip: selectedTip,
            couponCode: appliedCoupon ? appliedCoupon.code : null,
            couponDiscount: couponDiscount,
            total: total,
            paymentMethod: 'efectivo',
            isPagoServicios: true,
            receiptDeliveryType: receiptDeliveryType
          });
          closeModal();
          setTimeout(() => {
            location.hash = `#/pedido/${orderId}`;
          }, 150);
        } catch (e) {
          console.error('Error creating Pago de Servicios order:', e);
          showToast('Error al crear el trámite de pago: ' + e.message, 'error');
        }
      }
    });
  };

  updateCost();
}
