
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

      <div style="padding: 10px 14px 14px; display: flex; flex-direction: column; gap: 8px; width: 100%; box-sizing: border-box; max-width: 600px; margin: 0 auto; height: 100%; position: relative; z-index: 2;">
        
        <!-- Option 1: Encomienda -->
        <div id="favor-mandado-btn" class="gofavores-card card-encomienda glow-hover spring-hover" style="border-radius: 20px; padding: 18px 16px; border: 1px solid rgba(255,255,255,0.15); cursor: pointer; display: flex; align-items: center; gap: 16px; width: 100%; box-sizing: border-box; position: relative; box-shadow: 0 4px 20px rgba(0,0,0,0.015); animation: fadeInUp 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) 0.05s both;">
          <!-- Ambient light reflection -->
          <div style="position: absolute; top: -50%; left: -50%; width: 200%; height: 200%; background: radial-gradient(circle, rgba(255,255,255,0.15) 0%, transparent 60%); pointer-events: none;"></div>
          <div class="gofavores-icon-box" style="width: 54px; height: 54px; border-radius: 16px; background: rgba(255, 255, 255, 0.2); color: #ffffff; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 8px rgba(0,0,0,0.06); border: 1px solid rgba(255,255,255,0.15); backdrop-filter: blur(5px); -webkit-backdrop-filter: blur(5px); z-index: 2;">
            ${icon('package', 28)}
          </div>
          <div style="flex: 1; min-width: 0; text-align: left; z-index: 2;">
            <h3 style="font-family: var(--font-display); font-size: 16px; font-weight: 900; margin: 0 0 2px; color: #ffffff; letter-spacing: -0.02em; text-shadow: 0 1px 2px rgba(0,0,0,0.1);">Encomienda</h3>
            <p style="font-size: 12px; color: rgba(255, 255, 255, 0.9); line-height: 1.35; margin: 0; font-weight: 600;">Buscamos y llevamos lo que necesites donde nos digas.</p>
            <span style="display: inline-flex; align-items: center; gap: 4px; margin-top: 6px; background: rgba(255, 255, 255, 0.2); padding: 4px 10px; border-radius: 8px; color: #ffffff; font-size: 9.0px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.05em; border: 1px solid rgba(255, 255, 255, 0.25);">
              Costo normal de envío
            </span>
          </div>
          <div style="display: flex; flex-direction: column; gap: 8px; align-items: center; justify-content: center; flex-shrink: 0; z-index: 2;">
            <div id="info-mandado-btn" class="info-btn-favores" style="color: #ffffff; display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 50%; background: rgba(255, 255, 255, 0.2); cursor: pointer; transition: background 0.2s;">
              ${icon('info', 16)}
            </div>
            <div class="chevron-icon-container" style="color: #ffffff; display: flex; align-items: center; background: rgba(255, 255, 255, 0.2); width: 32px; height: 32px; border-radius: 50%; justify-content: center; border: 1px solid rgba(255, 255, 255, 0.25);">
              ${icon('chevronRight', 14)}
            </div>
          </div>
        </div>

        <!-- Option 2: Mandado -->
        <div id="favor-compra-btn" class="gofavores-card card-mandado glow-hover spring-hover" style="border-radius: 20px; padding: 18px 16px; border: 1px solid rgba(255,255,255,0.15); cursor: pointer; display: flex; align-items: center; gap: 16px; width: 100%; box-sizing: border-box; position: relative; box-shadow: 0 4px 20px rgba(0,0,0,0.015); animation: fadeInUp 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) 0.12s both;">
          <!-- Ambient light reflection -->
          <div style="position: absolute; top: -50%; left: -50%; width: 200%; height: 200%; background: radial-gradient(circle, rgba(255,255,255,0.15) 0%, transparent 60%); pointer-events: none;"></div>
          <div class="gofavores-icon-box" style="width: 54px; height: 54px; border-radius: 16px; background: rgba(255, 255, 255, 0.2); color: #ffffff; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 8px rgba(0,0,0,0.06); border: 1px solid rgba(255,255,255,0.15); backdrop-filter: blur(5px); -webkit-backdrop-filter: blur(5px); z-index: 2;">
            ${icon('shoppingBag', 28)}
          </div>
          <div style="flex: 1; min-width: 0; text-align: left; z-index: 2;">
            <h3 style="font-family: var(--font-display); font-size: 16px; font-weight: 900; margin: 0 0 2px; color: #ffffff; letter-spacing: -0.02em; text-shadow: 0 1px 2px rgba(0,0,0,0.1);">Mandado</h3>
            <p style="font-size: 12px; color: rgba(255, 255, 255, 0.9); line-height: 1.35; margin: 0; font-weight: 600;">Compramos lo que necesites en cualquier negocio local.</p>
            <span style="display: inline-flex; align-items: center; gap: 4px; margin-top: 6px; background: rgba(255, 255, 255, 0.2); padding: 4px 10px; border-radius: 8px; color: #ffffff; font-size: 9.0px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.05em; border: 1px solid rgba(255, 255, 255, 0.25);">
              Tarifa de gestión
            </span>
          </div>
          <div style="display: flex; flex-direction: column; gap: 8px; align-items: center; justify-content: center; flex-shrink: 0; z-index: 2;">
            <div id="info-compra-btn" class="info-btn-favores" style="color: #ffffff; display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 50%; background: rgba(255, 255, 255, 0.2); cursor: pointer; transition: background 0.2s;">
              ${icon('info', 16)}
            </div>
            <div class="chevron-icon-container" style="color: #ffffff; display: flex; align-items: center; background: rgba(255, 255, 255, 0.2); width: 32px; height: 32px; border-radius: 50%; justify-content: center; border: 1px solid rgba(255, 255, 255, 0.25);">
              ${icon('chevronRight', 14)}
            </div>
          </div>
        </div>

        <!-- Option 3: Go Cash -->
        <div id="favor-gocash-btn" class="gofavores-card card-gocash glow-hover spring-hover" style="border-radius: 20px; padding: 18px 16px; border: 1px solid rgba(255,255,255,0.15); cursor: pointer; display: flex; align-items: center; gap: 16px; width: 100%; box-sizing: border-box; position: relative; box-shadow: 0 4px 20px rgba(0,0,0,0.015); animation: fadeInUp 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) 0.18s both;">
          <!-- Ambient light reflection -->
          <div style="position: absolute; top: -50%; left: -50%; width: 200%; height: 200%; background: radial-gradient(circle, rgba(255,255,255,0.15) 0%, transparent 60%); pointer-events: none;"></div>
          <div class="gofavores-icon-box" style="width: 54px; height: 54px; border-radius: 16px; background: rgba(255, 255, 255, 0.2); color: #ffffff; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 8px rgba(0,0,0,0.06); border: 1px solid rgba(255,255,255,0.15); backdrop-filter: blur(5px); -webkit-backdrop-filter: blur(5px); z-index: 2;">
            ${icon('dollarSign', 28)}
          </div>
          <div style="flex: 1; min-width: 0; text-align: left; z-index: 2;">
            <h3 style="font-family: var(--font-display); font-size: 16px; font-weight: 900; margin: 0 0 2px; color: #ffffff; letter-spacing: -0.02em; text-shadow: 0 1px 2px rgba(0,0,0,0.1);">Go Cash</h3>
            <p style="font-size: 12px; color: rgba(255, 255, 255, 0.9); line-height: 1.35; margin: 0; font-weight: 600;">Cambiá efectivo por transferencia o viceversa.</p>
            <span style="display: inline-flex; align-items: center; gap: 4px; margin-top: 6px; background: rgba(255, 255, 255, 0.2); padding: 4px 10px; border-radius: 8px; color: #ffffff; font-size: 9.0px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.05em; border: 1px solid rgba(255, 255, 255, 0.25);">
              Efectivo ↔ Transferencia
            </span>
          </div>
          <div style="display: flex; flex-direction: column; gap: 8px; align-items: center; justify-content: center; flex-shrink: 0; z-index: 2;">
            <div id="info-gocash-btn" class="info-btn-favores" style="color: #ffffff; display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 50%; background: rgba(255, 255, 255, 0.2); cursor: pointer; transition: background 0.2s;">
              ${icon('info', 16)}
            </div>
            <div class="chevron-icon-container" style="color: #ffffff; display: flex; align-items: center; background: rgba(255, 255, 255, 0.2); width: 32px; height: 32px; border-radius: 50%; justify-content: center; border: 1px solid rgba(255, 255, 255, 0.25);">
              ${icon('chevronRight', 14)}
            </div>
          </div>
        </div>

        <!-- Info Section -->
        <div class="gofavores-info-section" style="flex: 1; margin-top: 4px; padding: 18px 20px; border-radius: 20px; border: 1px dashed var(--color-border); width: 100%; box-sizing: border-box; display: flex; flex-direction: column; justify-content: space-between; box-shadow: 0 4px 20px rgba(0,0,0,0.015); animation: fadeInUp 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) 0.24s both;">
          <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
            <div style="width:32px; height:32px; border-radius:8px; background:rgba(var(--color-primary-rgb),0.15); color:var(--color-primary); display:flex; align-items:center; justify-content:center;">
              ${icon('info', 18)}
            </div>
            <h4 style="font-family: var(--font-display); font-size: 16px; font-weight: 900; color: var(--color-text-primary); margin: 0;">¿Cómo funciona GoFavores?</h4>
          </div>
          <ul style="margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; justify-content: space-between; flex: 1; padding-bottom: 4px;">
            <li style="display:flex; gap:12px; align-items: flex-start; margin-top: 4px;">
               <div style="width:20px; height:20px; border-radius:50%; background:var(--color-primary); color:white; display:flex; align-items:center; justify-content:center; flex-shrink:0; font-size:11px; font-weight:900; margin-top:2px;">1</div>
               <div style="display: flex; flex-direction: column;">
                 <span style="font-size: 13.5px; color: var(--color-text-primary); font-weight: 800; line-height: 1.2;">Completás el formulario</span>
                 <span style="font-size: 11.5px; color: var(--color-text-secondary); font-weight: 600; line-height: 1.3; margin-top: 2px;">Ingresá el origen, el destino y las aclaraciones sobre qué requerís.</span>
               </div>
            </li>
            <li style="display:flex; gap:12px; align-items: flex-start; margin-top: 4px;">
               <div style="width:20px; height:20px; border-radius:50%; background:var(--color-primary); color:white; display:flex; align-items:center; justify-content:center; flex-shrink:0; font-size:11px; font-weight:900; margin-top:2px;">2</div>
               <div style="display: flex; flex-direction: column;">
                 <span style="font-size: 13.5px; color: var(--color-text-primary); font-weight: 800; line-height: 1.2;">Contacto y coordinación</span>
                 <span style="font-size: 11.5px; color: var(--color-text-secondary); font-weight: 600; line-height: 1.3; margin-top: 2px;">El repartidor asignado te escribirá por chat privado ante cualquier duda comercial.</span>
               </div>
            </li>
            <li style="display:flex; gap:12px; align-items: flex-start; margin-top: 4px;">
               <div style="width:20px; height:20px; border-radius:50%; background:var(--color-primary); color:white; display:flex; align-items:center; justify-content:center; flex-shrink:0; font-size:11px; font-weight:900; margin-top:2px;">3</div>
               <div style="display: flex; flex-direction: column;">
                 <span style="font-size: 13.5px; color: var(--color-text-primary); font-weight: 800; line-height: 1.2;">Seguís el recorrido en vivo</span>
                 <span style="font-size: 11.5px; color: var(--color-text-secondary); font-weight: 600; line-height: 1.3; margin-top: 2px;">Seguí el recorrido en tiempo real sobre el mapa integrado hasta tu puerta.</span>
               </div>
            </li>
          </ul>
        </div>
      </div>
    </div>
    
    <style>
      #app-content:has(.gofavores-page) {
        overflow: hidden !important;
        height: 100% !important;
      }
      .slide-overlay:has(.gofavores-page) {
        overflow-y: hidden !important;
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
}

function showServiceInfoModal(service) {
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
          <li><strong>Límite de financiación:</strong> El repartidor puede abonar compras de hasta $30.000 de su propio bolsillo. Para compras mayores, debés coordinar una transferencia bancaria previa con él.</li>
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

async function showMandadoForm() {
  const { geocodeAddress, getDistance, calculateDynamicFee } = await import('../utils/geo.js');
  const user = getState().user;
  const currentAddress = getState().deliveryAddress || '';

  const modalEl = document.createElement('div');
  modalEl.style.cssText = 'padding: 24px; background: var(--color-bg); height: 100%; display: flex; flex-direction: column; gap: 20px;';
  modalEl.innerHTML = `
    <div style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 16px; padding-bottom:12px;">
      <div style="display:flex; flex-direction:column; gap:8px; margin-top:14px;">
        <label style="font-size: 11px; font-weight: 900; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing:0.5px;">Origen: ¿Dónde recogemos?</label>
        <button id="pickup-addr-btn" style="width: 100%; height: 60px; border-radius: 18px; border: 1.5px solid var(--color-border-light); padding: 0 16px; background: var(--color-bg-card); font-size: 14px; font-weight: 700; display:flex; align-items:center; gap:12px; text-align:left; color:var(--color-text-secondary); cursor:pointer; transition:all 0.2s;">
           <div style="width:36px; height:36px; border-radius:12px; background:rgba(var(--color-primary-rgb),0.1); color:var(--color-primary); display:flex; align-items:center; justify-content:center; flex-shrink:0;">${icon('mapPin', 20)}</div>
           <span id="pickup-text" style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">Elegir dirección en el mapa...</span>
           ${icon('chevronRight', 16)}
        </button>
        <input type="text" id="pickup-details" placeholder="Detalle: Nro, depto, timbre, local o ref (Obligatorio)" style="height:44px; border-radius:12px; border:1.5px solid var(--color-border-light); padding:0 12px; background:var(--color-bg-card); font-size:13px; font-weight:600; outline:none;" />
      </div>

      <div style="display:flex; flex-direction:column; gap:8px;">
        <label style="font-size: 11px; font-weight: 900; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing:0.5px;">Destino: ¿Dónde entregamos?</label>
        <button id="delivery-addr-btn" style="width: 100%; height: 60px; border-radius: 18px; border: 1.5px solid var(--color-border-light); padding: 0 16px; background: var(--color-bg-card); font-size: 14px; font-weight: 700; display:flex; align-items:center; gap:12px; text-align:left; color:var(--color-text-primary); cursor:pointer; transition:all 0.2s;">
           <div style="width:36px; height:36px; border-radius:12px; background:rgba(34, 197, 94, 0.1); color:#22c55e; display:flex; align-items:center; justify-content:center; flex-shrink:0;">${icon('home', 20)}</div>
           <span id="delivery-text" style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${currentAddress || 'Elegir destino...'}</span>
           ${icon('chevronRight', 16)}
        </button>
        <input type="text" id="delivery-details" placeholder="Detalle: Nro, depto, timbre, local o ref (Obligatorio)" style="height:44px; border-radius:12px; border:1.5px solid var(--color-border-light); padding:0 12px; background:var(--color-bg-card); font-size:13px; font-weight:600; outline:none;" />
      </div>

      <div>
        <label style="font-size: 11px; font-weight: 900; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing:0.5px; margin-bottom:12px; display:block;">Detalles de la Encomienda</label>
        <textarea id="favor-details" placeholder="Ej: Recoger llaves en el portero y traerlas. Contacto: Juan 123456..." style="width: 100%; height: 110px; border-radius: 18px; border: 1.5px solid var(--color-border-light); padding: 16px; background: var(--color-bg-card); font-size: 14px; font-weight: 600; resize: none; outline:none; font-family:inherit;"></textarea>
      </div>

      <!-- Método de pago -->
      <div style="display:flex; flex-direction:column; gap:8px;">
        <label style="font-size: 11px; font-weight: 900; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing:0.5px;">Método de Pago del Envío</label>
        <div style="display:flex; background:var(--color-bg-secondary); padding:4px; border-radius:16px; border:1.5px solid var(--color-border-light);">
          <button type="button" id="mandado-pay-efectivo" style="flex:1; height:40px; border-radius:12px; border:none; font-size:12px; font-weight:800; cursor:pointer; transition:all 0.2s; background:var(--color-surface); color:var(--color-text-primary); box-shadow:var(--shadow-sm); display:flex; align-items:center; justify-content:center; gap:6px;">
            ${icon('dollarSign', 14)} Efectivo
          </button>
          <button type="button" id="mandado-pay-transfer" style="flex:1; height:40px; border-radius:12px; border:none; font-size:12px; font-weight:800; cursor:pointer; transition:all 0.2s; background:transparent; color:var(--color-text-secondary); display:flex; align-items:center; justify-content:center; gap:6px;">
            ${icon('creditCard', 14)} Transferencia
          </button>
        </div>
      </div>
      
      <div id="cost-preview" style="background: var(--color-bg-secondary); padding: 16px; border-radius: 20px; display: none; flex-direction:column; gap:8px; border:1px solid var(--color-border-light); margin-top:auto;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span style="font-weight: 600; color: var(--color-text-secondary); font-size: 12px;">Envío (distancia)</span>
          <span id="dist-cost" style="font-size: 13px; font-weight: 700; color: var(--color-text-primary);">$ 0</span>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span style="font-weight: 600; color: var(--color-text-secondary); font-size: 12px;">Tarifa servicio</span>
          <span id="service-cost" style="font-size: 13px; font-weight: 700; color: var(--color-text-primary);">$ 0</span>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:4px; padding-top:8px; border-top:1px dashed var(--color-border-light);">
          <span style="font-weight: 900; color: var(--color-primary); font-size: 15px;">Total Servicio</span>
          <span id="estimated-cost" style="font-size: 20px; font-weight: 950; color: var(--color-primary);">$ 0</span>
        </div>
        <p style="font-size: 10px; color: var(--color-text-tertiary); margin-top: 8px; font-weight: 600; text-align: center;">
          * Este es el costo por el servicio de envío.
        </p>
      </div>
    </div>

    <button id="confirm-favor-btn" style="width: 100%; height: 60px; border-radius: 20px; background: var(--color-primary); color: white; border: none; font-weight: 900; font-size: 16px; cursor: pointer; box-shadow: 0 10px 25px rgba(var(--color-primary-rgb), 0.3); text-transform: uppercase; letter-spacing: 0.05em; display: flex; align-items: center; justify-content: center; gap: 10px;">
      ${icon('check', 20)} Solicitar Encomienda
    </button>
  `;

  showModal({ title: 'Detalles de la Encomienda', content: modalEl, height: '80dvh', hideHeader: true });

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
  let selectedPaymentMethod = 'efectivo';

  const payEfectivoBtn = modalEl.querySelector('#mandado-pay-efectivo');
  const payTransferBtn = modalEl.querySelector('#mandado-pay-transfer');

  payEfectivoBtn.onclick = () => {
    selectedPaymentMethod = 'efectivo';
    payEfectivoBtn.style.background = 'var(--color-surface)';
    payEfectivoBtn.style.color = 'var(--color-text-primary)';
    payEfectivoBtn.style.boxShadow = 'var(--shadow-sm)';
    payTransferBtn.style.background = 'transparent';
    payTransferBtn.style.color = 'var(--color-text-secondary)';
    payTransferBtn.style.boxShadow = 'none';
  };

  payTransferBtn.onclick = () => {
    selectedPaymentMethod = 'mercadopago';
    payTransferBtn.style.background = 'var(--color-surface)';
    payTransferBtn.style.color = 'var(--color-text-primary)';
    payTransferBtn.style.boxShadow = 'var(--shadow-sm)';
    payEfectivoBtn.style.background = 'transparent';
    payEfectivoBtn.style.color = 'var(--color-text-secondary)';
    payEfectivoBtn.style.boxShadow = 'none';
  };

  const updateCost = async () => {
    if (pickupData && deliveryData) {
      try {
        const dist = await getDistance(pickupData.coords.lat, pickupData.coords.lng, deliveryData.coords.lat, deliveryData.coords.lng);
        calculatedFee = calculateDynamicFee(dist);
        
        const appUsageFeeRate = getState().appUsageFeeRate || 0.05;
        appFee = Math.ceil((calculatedFee * appUsageFeeRate) / 10) * 10;
        const total = calculatedFee + appFee;

        distCostEl.textContent = formatPrice(calculatedFee);
        serviceCostEl.textContent = formatPrice(appFee);
        totalCostEl.textContent = formatPrice(total);
        previewBox.style.display = 'flex';
      } catch (e) {}
    }
  };

  pickupBtn.onclick = () => {
    showAddressPrompt((addr, notes, coords) => {
      pickupData = { address: addr, coords };
      pickupText.textContent = addr;
      pickupText.style.color = 'var(--color-text-primary)';
      updateCost();
    }, { mode: 'pick' });
  };

  deliveryBtn.onclick = () => {
    showAddressPrompt((addr, notes, coords) => {
      deliveryData = { address: addr, coords };
      deliveryText.textContent = addr;
      updateCost();
    });
  };

  modalEl.querySelector('#confirm-favor-btn').onclick = async () => {
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

    if (calculatedFee === 0) {
      await updateCost();
    }

    const total = calculatedFee + appFee;

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
            deliveryCost: calculatedFee,
            appUsageFee: appFee,
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
    appUsageFee: data.appUsageFee || 0,
    total: data.total,
    paymentMethod: data.paymentMethod
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

async function showCompraForm() {
  const { getDistance, calculateDynamicFee } = await import('../utils/geo.js');
  const user = getState().user;
  const currentAddress = getState().deliveryAddress || '';
  const purchaseFee = getState().deliveryPurchaseFee || 500;

  const modalEl = document.createElement('div');
  modalEl.style.cssText = 'padding: 24px; background: var(--color-bg); height: 100%; display: flex; flex-direction: column; gap: 20px;';
  modalEl.innerHTML = `
    <div style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 16px; padding-bottom:12px;">
      
      <div style="display:flex; flex-direction:column; gap:12px; margin-top: 16px;">
        <label style="font-size: 11px; font-weight: 900; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing:0.5px;">¿Cuántos comercios querés visitar?</label>
        <div style="display:grid; grid-template-columns: repeat(5, 1fr); gap:8px;">
          ${[1, 2, 3, 4, 5].map(n => `
            <button type="button" class="stop-count-btn" data-stops="${n}" style="height:44px; border-radius:12px; border:2px solid ${n === 1 ? 'var(--color-primary)' : 'var(--color-border-light)'}; background:${n === 1 ? 'rgba(var(--color-primary-rgb),0.08)' : 'var(--color-bg-card)'}; color:${n === 1 ? 'var(--color-primary)' : 'var(--color-text-secondary)'}; font-weight:900; font-size:14px; cursor:pointer;">
              ${n}
            </button>
          `).join('')}
        </div>
        <p id="extra-stop-note" style="font-size:10px; color:var(--color-text-tertiary); margin:6px 0 0; font-weight:600; display:none; line-height:1.4;">
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
        <button id="delivery-addr-btn" style="width: 100%; height: 60px; border-radius: 18px; border: 1.5px solid var(--color-border-light); padding: 0 16px; background: var(--color-bg-card); font-size: 14px; font-weight: 700; display:flex; align-items:center; gap:12px; text-align:left; color:var(--color-text-primary); cursor:pointer; transition:all 0.2s;">
           <div style="width:36px; height:36px; border-radius:12px; background:rgba(34, 197, 94, 0.1); color:#22c55e; display:flex; align-items:center; justify-content:center; flex-shrink:0;">${icon('home', 20)}</div>
           <span id="delivery-text" style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${currentAddress || 'Elegir destino...'}</span>
           ${icon('chevronRight', 16)}
        </button>
        <input type="text" id="delivery-details" placeholder="Detalle: Nro, depto, timbre, local o ref (Obligatorio)" style="height:44px; border-radius:12px; border:1.5px solid var(--color-border-light); padding:0 12px; background:var(--color-bg-card); font-size:13px; font-weight:600; outline:none;" />
      </div>

      <!-- Método de pago -->
      <div style="display:flex; flex-direction:column; gap:8px;">
        <label style="font-size: 11px; font-weight: 900; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing:0.5px;">Método de Pago del Envío</label>
        <div style="display:flex; background:var(--color-bg-secondary); padding:4px; border-radius:16px; border:1.5px solid var(--color-border-light);">
          <button type="button" id="compra-pay-efectivo" style="flex:1; height:40px; border-radius:12px; border:none; font-size:12px; font-weight:800; cursor:pointer; transition:all 0.2s; background:var(--color-surface); color:var(--color-text-primary); box-shadow:var(--shadow-sm); display:flex; align-items:center; justify-content:center; gap:6px;">
            ${icon('dollarSign', 14)} Efectivo
          </button>
          <button type="button" id="compra-pay-transfer" style="flex:1; height:40px; border-radius:12px; border:none; font-size:12px; font-weight:800; cursor:pointer; transition:all 0.2s; background:transparent; color:var(--color-text-secondary); display:flex; align-items:center; justify-content:center; gap:6px;">
            ${icon('creditCard', 14)} Transferencia
          </button>
        </div>
      </div>

      <!-- Cost preview -->
      <div id="compra-cost-preview" style="background: var(--color-bg-secondary); border-radius: 20px; padding: 16px; border: 1px solid var(--color-border-light); display:none; flex-direction:column; gap:8px; margin-top:auto;">
        <div style="display:flex; justify-content:space-between; font-size:12px; color:var(--color-text-secondary); font-weight:600;">
          <span>Envío estimado</span><span id="dist-fee">$ ---</span>
        </div>
        <div style="display:flex; justify-content:space-between; font-size:12px; color:var(--color-text-secondary); font-weight:600;">
          <span>Gestión especial</span><span>+ ${formatPrice(purchaseFee)}</span>
        </div>
        <div id="extra-stops-row" style="display:none; justify-content:space-between; font-size:12px; color:var(--color-text-secondary); font-weight:600;">
          <span id="extra-stops-label">Paradas extra</span><span id="extra-stops-fee">$ ---</span>
        </div>
        <div style="display:flex; justify-content:space-between; font-size:12px; color:var(--color-text-secondary); font-weight:600;">
          <span>Servicio App</span><span id="app-service-fee">$ ---</span>
        </div>
        <div style="display:flex; justify-content:space-between; font-size:16px; font-weight:950; color:var(--color-primary); border-top:1px dashed var(--color-border-light); padding-top:8px; margin-top:2px;">
          <span>Total Servicio</span><span id="final-service-fee">$ ---</span>
        </div>
        <p style="font-size:10px; color:var(--color-text-tertiary); margin-top:4px; line-height:1.3; font-weight:600; text-align:center;">
          * El valor de los productos se abona al repartidor al recibirlos.
        </p>
      </div>
    </div>

    <button id="confirm-buy-btn" style="width:100%; height:60px; border-radius:20px; background:var(--color-primary); color:white; border:none; font-weight:900; font-size:16px; cursor:pointer; box-shadow:0 10px 25px rgba(var(--color-primary-rgb),0.3); text-transform:uppercase; letter-spacing:0.05em; display:flex; align-items:center; justify-content:center; gap:10px; flex-shrink:0;">
      ${icon('check', 20)} Solicitar Compra
    </button>
  `;

  showModal({ title: 'GoFavor: Comprar algo', content: modalEl, height: '85dvh', hideHeader: true });

  const deliveryBtn   = modalEl.querySelector('#delivery-addr-btn');
  const deliveryText  = modalEl.querySelector('#delivery-text');
  const distFeeEl     = modalEl.querySelector('#dist-fee');
  const appFeeEl      = modalEl.querySelector('#app-service-fee');
  const totalFeeEl    = modalEl.querySelector('#final-service-fee');
  const extraStopsRow = modalEl.querySelector('#extra-stops-row');
  const extraStopsLbl = modalEl.querySelector('#extra-stops-label');
  const extraStopsFeeEl = modalEl.querySelector('#extra-stops-fee');
  const extraStopNote = modalEl.querySelector('#extra-stop-note');
  const previewBox    = modalEl.querySelector('#compra-cost-preview');
  const subformsContainer = modalEl.querySelector('#stores-subforms-container');

  const centerCoords = { lat: -35.0811, lng: -57.5146 };
  let deliveryData = currentAddress ? { address: currentAddress, coords: getState().deliveryCoords } : null;
  let calculatedDistFee = 0;
  let appFee = 0;
  let stopsCount = 1;
  const extraStopFee = getState().deliveryExtraStopFee || 500;
  let selectedPaymentMethod = 'efectivo';

  const payEfectivoBtn = modalEl.querySelector('#compra-pay-efectivo');
  const payTransferBtn = modalEl.querySelector('#compra-pay-transfer');

  payEfectivoBtn.onclick = () => {
    selectedPaymentMethod = 'efectivo';
    payEfectivoBtn.style.background = 'var(--color-surface)';
    payEfectivoBtn.style.color = 'var(--color-text-primary)';
    payEfectivoBtn.style.boxShadow = 'var(--shadow-sm)';
    payTransferBtn.style.background = 'transparent';
    payTransferBtn.style.color = 'var(--color-text-secondary)';
    payTransferBtn.style.boxShadow = 'none';
  };

  payTransferBtn.onclick = () => {
    selectedPaymentMethod = 'mercadopago';
    payTransferBtn.style.background = 'var(--color-surface)';
    payTransferBtn.style.color = 'var(--color-text-primary)';
    payTransferBtn.style.boxShadow = 'var(--shadow-sm)';
    payEfectivoBtn.style.background = 'transparent';
    payEfectivoBtn.style.color = 'var(--color-text-secondary)';
    payEfectivoBtn.style.boxShadow = 'none';
  };

  const placeholders = [
    { name: "Ej: Paulos", detail: "Ej: 1 pack de brahma" },
    { name: "Ej: Heladería Grido", detail: "Ej: 1kg de helado de chocolate" },
    { name: "Ej: Chino Rivadavia", detail: "Ej: 1 cartón de leche entera" },
    { name: "Ej: Panadería La Espiga", detail: "Ej: Medio kilo de pan miñón" },
    { name: "Ej: Kiosco Magdalena", detail: "Ej: 2 alfajores y chicles" }
  ];

  const renderSubforms = () => {
    subformsContainer.innerHTML = '';
    for (let i = 0; i < stopsCount; i++) {
      const card = document.createElement('div');
      card.className = 'store-card';
      card.style.cssText = 'background:var(--color-bg-secondary); border-radius:20px; padding:16px; border:1.5px solid var(--color-border-light); display:flex; flex-direction:column; gap:12px;';
      
      const pl = placeholders[i] || placeholders[0];
      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span style="font-size:12px; font-weight:900; color:var(--color-primary); text-transform:uppercase; letter-spacing:0.5px;">🏪 Comercio #${i + 1}</span>
        </div>
        <div style="display:flex; flex-direction:column; gap:6px;">
          <input type="text" class="store-name-input" placeholder="${pl.name}" style="height:46px; border-radius:12px; border:1.5px solid var(--color-border-light); padding:0 12px; background:var(--color-surface); font-size:14px; font-weight:700; outline:none;" required />
        </div>
        <div style="display:flex; flex-direction:column; gap:6px;">
          <textarea class="store-detail-textarea" placeholder="${pl.detail}" style="height:76px; border-radius:12px; border:1.5px solid var(--color-border-light); padding:12px; background:var(--color-surface); font-size:13.5px; font-weight:600; outline:none; resize:none; font-family:inherit; line-height:1.4;" required></textarea>
        </div>
      `;
      subformsContainer.appendChild(card);
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
      const appUsageFeeRate = getState().appUsageFeeRate || 0.05;
      appFee = Math.ceil((subtotal * appUsageFeeRate) / 10) * 10;
      const total = subtotal + appFee;

      distFeeEl.textContent = formatPrice(calculatedDistFee);
      appFeeEl.textContent  = formatPrice(appFee);
      totalFeeEl.textContent = formatPrice(total);

      if (stopsCount > 1) {
        extraStopsRow.style.display = 'flex';
        extraStopsLbl.textContent   = `Paradas extra (×${stopsCount - 1})`;
        extraStopsFeeEl.textContent = `+ ${formatPrice(extraStopsTotal)}`;
      } else {
        extraStopsRow.style.display = 'none';
      }
      previewBox.style.display = 'flex';
    } catch (e) { console.error(e); }
  };

  deliveryBtn.onclick = () => {
    showAddressPrompt((addr, notes, coords) => {
      deliveryData = { address: addr, coords };
      deliveryText.textContent = addr;
      updateCost();
    });
  };

  if (deliveryData?.coords) updateCost();

  modalEl.querySelector('#confirm-buy-btn').onclick = async () => {
    const nameInputs = Array.from(subformsContainer.querySelectorAll('.store-name-input'));
    const detailTextareas = Array.from(subformsContainer.querySelectorAll('.store-detail-textarea'));
    const deliveryDetailsInput = modalEl.querySelector('#delivery-details');
    const deliveryDetails = deliveryDetailsInput ? deliveryDetailsInput.value.trim() : '';

    let validated = true;
    const stopsList = [];

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
        stopsList.push({ store: name, items: details });
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

    if (calculatedDistFee === 0) await updateCost();

    const extraStopsTotal = (stopsCount - 1) * extraStopFee;
    const subtotal = calculatedDistFee + purchaseFee + extraStopsTotal;
    const total = subtotal + appFee;
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
            deliveryCost: calculatedDistFee,
            purchaseFee: purchaseFee,
            extraStopsFee: extraStopsTotal,
            stopsCount: stopsCount,
            appUsageFee: appFee,
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

async function showGoCashForm() {
  const { geocodeAddress, getDistance, calculateDynamicFee } = await import('../utils/geo.js');
  const user = getState().user;
  const currentAddress = getState().deliveryAddress || '';

  const modalEl = document.createElement('div');
  modalEl.style.cssText = 'padding: 24px; background: var(--color-bg); height: 100%; display: flex; flex-direction: column; gap: 20px;';
  modalEl.innerHTML = `
    <div style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 16px; padding-bottom:12px;">
      
      <!-- Type Selector Segmented Control -->
      <div style="display:flex; flex-direction:column; gap:8px; margin-top:14px;">
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
          <input type="number" id="gocash-amount" placeholder="0" min="1" max="70000" style="width: 100%; height: 54px; border-radius: 18px; border: 1.5px solid var(--color-border-light); padding: 0 16px 0 35px; background: var(--color-bg-card); font-size: 18px; font-weight: 800; outline: none; transition: border-color 0.2s;" />
        </div>
      </div>

      <div style="display:flex; flex-direction:column; gap:8px;">
        <label style="font-size: 11px; font-weight: 900; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing:0.5px;">¿Dónde nos encontramos?</label>
        <button id="gocash-delivery-addr-btn" style="width: 100%; height: 60px; border-radius: 18px; border: 1.5px solid var(--color-border-light); padding: 0 16px; background: var(--color-bg-card); font-size: 14px; font-weight: 700; display:flex; align-items:center; gap:12px; text-align:left; color:var(--color-text-primary); cursor:pointer; transition:all 0.2s;">
           <div style="width:36px; height:36px; border-radius:12px; background:rgba(34, 197, 94, 0.1); color:#22c55e; display:flex; align-items:center; justify-content:center; flex-shrink:0;">${icon('home', 20)}</div>
           <span id="gocash-delivery-text" style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${currentAddress || 'Elegir destino...'}</span>
           ${icon('chevronRight', 16)}
        </button>
        <input type="text" id="gocash-delivery-details" placeholder="Detalle: Nro, depto, timbre, local o ref (Obligatorio)" style="height:44px; border-radius:12px; border:1.5px solid var(--color-border-light); padding:0 12px; background:var(--color-bg-card); font-size:13px; font-weight:600; outline:none;" />
      </div>

      <!-- Cost Preview -->
      <div id="gocash-cost-preview" style="background: var(--color-bg-secondary); padding: 16px; border-radius: 20px; display: none; flex-direction:column; gap:8px; border:1px solid var(--color-border-light); margin-top:auto;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span style="font-weight: 600; color: var(--color-text-secondary); font-size: 12px;">Envío estimado (desde centro)</span>
          <span id="gocash-dist-cost" style="font-size: 13px; font-weight: 700; color: var(--color-text-primary);">$ 0</span>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:4px; padding-top:8px; border-top:1px dashed var(--color-border-light);">
          <span style="font-weight: 900; color: var(--color-primary); font-size: 15px;">Total Envío Estimado</span>
          <span id="gocash-estimated-cost" style="font-size: 20px; font-weight: 950; color: var(--color-primary);">$ 0</span>
        </div>
        <p style="font-size: 10px; color: var(--color-text-tertiary); margin-top: 8px; font-weight: 600; text-align: center; line-height:1.4;">
          * Se cobra únicamente el envío. El costo final se recalculará en base a la ubicación real del repartidor al aceptar.
        </p>
      </div>
    </div>

    <button id="confirm-gocash-btn" style="width: 100%; height: 60px; border-radius: 20px; background: var(--color-primary); color: white; border: none; font-weight: 900; font-size: 16px; cursor: pointer; box-shadow: 0 10px 25px rgba(var(--color-primary-rgb), 0.3); text-transform: uppercase; letter-spacing: 0.05em; display: flex; align-items: center; justify-content: center; gap: 10px;">
      ${icon('check', 20)} Solicitar Go Cash
    </button>
  `;

  showModal({ title: 'Solicitar Go Cash', content: modalEl, height: '80dvh', hideHeader: true });

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

        distCostEl.textContent = formatPrice(calculatedFee);
        totalCostEl.textContent = formatPrice(calculatedFee);
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
      updateCost();
    });
  };

  modalEl.querySelector('#confirm-gocash-btn').onclick = async () => {
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

    if (calculatedFee === 0) {
      await updateCost();
    }

    const typeText = selectedType === 'cash_to_transfer' ? 'Efectivo a Transferencia' : 'Transferencia a Efectivo';
    
    showConfirm({
      title: '¿Confirmar Go Cash?',
      message: `Se enviará un repartidor para cambiar <strong>${formatPrice(amount)}</strong> (${typeText}).<br><br>Costo estimado del envío: <strong>${formatPrice(calculatedFee)}</strong>`,
      onConfirm: async () => {
        try {
          const orderId = await createFavorOrder({
            type: 'gocash',
            pickupAddress: 'Ubicación del Repartidor',
            pickupCoords: { lat: -35.0811, lng: -57.5146 },
            deliveryAddress: `${deliveryData.address} (Detalle: ${deliveryDetails})`,
            deliveryCoords: deliveryData.coords,
            details: `Go Cash: Cambiar ${typeText} por valor de ${formatPrice(amount)}`,
            deliveryCost: calculatedFee,
            appUsageFee: 0,
            total: calculatedFee,
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
}
