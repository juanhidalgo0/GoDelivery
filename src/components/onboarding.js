/* GoDelivery — Onboarding Component */
import { icon } from '../utils/icons.js';
import { getState } from '../state.js';

export async function showOnboarding(onComplete) {
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

  if (localStorage.getItem('gd-onboarding-done')) {
    let locationStatus = 'prompt';
    if (navigator.permissions) {
      try {
        const res = await navigator.permissions.query({ name: 'geolocation' });
        locationStatus = res.state;
      } catch (e) {}
    }
    const notifStatus = 'Notification' in window ? Notification.permission : 'granted';
    
    if (locationStatus === 'denied' || notifStatus === 'denied') {
      localStorage.removeItem('gd-onboarding-done');
    } else {
      if (onComplete) onComplete();
      return;
    }
  }

  // 1. Determine which screens to show based on permissions
  const screens = [];
  
  // Check Location Permission
  let locationStatus = 'prompt';
  if (navigator.permissions) {
    try {
      const res = await navigator.permissions.query({ name: 'geolocation' });
      locationStatus = res.state;
    } catch (e) {}
  }
  
  if (locationStatus !== 'granted') {
    screens.push({
      id: 'location',
      image: '/onboarding_location_illustration.png',
      title: 'Ubicación Obligatoria',
      text: 'Para usar GoDelivery, es necesario acceder a tu ubicación. Así podremos mostrarte los locales cercanos a tu puerta.',
      btnText: 'Continuar',
      action: async () => {
        const { showToast } = await import('./toast.js');
        return new Promise((resolve) => {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
              import('../state.js').then(m => m.setState('deliveryCoords', coords));
              resolve(true);
            },
            (err) => {
              console.warn('Geolocation onboarding error:', err);
              // Si falla por cualquier motivo (incluso denegada en incógnito/PC), dejamos pasar
              // para que el usuario pueda escribir su dirección manualmente en el mapa interactivo.
              showToast('Ubicación no detectada. Podrás buscar tu dirección manualmente en el mapa.', 'info');
              resolve(true);
            },
            { timeout: 8000, enableHighAccuracy: false, maximumAge: 300000 }
          );
        });
      }
    });
  }

  // Check Notification Permission (Only mandatory on native Play Store / App Store apps)
  const isNativeApp = window.Capacitor && window.Capacitor.getPlatform && window.Capacitor.getPlatform() !== 'web';
  if (isNativeApp && 'Notification' in window && Notification.permission !== 'granted') {
    screens.push({
      id: 'notifications',
      image: '/onboarding_delivery_illustration.png',
      title: 'Notificaciones Obligatorias',
      text: 'Recibe avisos en tiempo real del estado de tus pedidos y chat. Activar las notificaciones es obligatorio para comprar.',
      btnText: 'Activar ahora',
      action: async () => {
        try {
          // Llamar inmediatamente para preservar el User Gesture Token
          const res = await Notification.requestPermission();
          if (res === 'granted') {
            return true;
          } else {
            const { showToast } = await import('./toast.js');
            showToast('Para usar GoDelivery es obligatorio activar las notificaciones. Habilítalas en la configuración de tu navegador.', 'warning');
            return false;
          }
        } catch (e) {
          const { showToast } = await import('./toast.js');
          showToast('No se pudieron activar las notificaciones. Habilítalas en la configuración.', 'warning');
          return false;
        }
      }
    });
  }

  // If no screens are needed, finish immediately
  if (screens.length === 0) {
    localStorage.setItem('gd-onboarding-done', 'true');
    if (onComplete) onComplete();
    return;
  }

  const container = document.createElement('div');
  container.id = 'onboarding-container';
  container.className = 'onboarding-overlay';

  let currentStep = 0;

  const finish = () => {
    localStorage.setItem('gd-onboarding-done', 'true');
    container.classList.add('fade-out');
    setTimeout(() => {
      container.remove();
      if (onComplete) onComplete();
    }, 400);
  };

  const renderStep = () => {
    const step = screens[currentStep];
    container.innerHTML = `
      <div class="onboarding-card page-enter">
        <div class="onboarding-image">
          <img src="${step.image}" alt="" />
        </div>
        <div class="onboarding-content">
          <h1 class="onboarding-title">${step.title}</h1>
          <p class="onboarding-text">${step.text}</p>
          <div id="permission-helper-container"></div>
        </div>
        <div class="onboarding-footer">
          <div class="onboarding-dots">
            ${screens.map((_, i) => `<div class="dot ${i === currentStep ? 'active' : ''}"></div>`).join('')}
          </div>
          <button class="btn btn-primary onboarding-next" id="onboarding-next">
            ${step.btnText}
          </button>
        </div>
      </div>
    `;

    document.getElementById('onboarding-next').onclick = async () => {
      const btn = document.getElementById('onboarding-next');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span>';
      
      const success = await step.action();
      
      if (success) {
        if (currentStep < screens.length - 1) {
          currentStep++;
          renderStep();
        } else {
          finish();
        }
      } else {
        btn.disabled = false;
        btn.innerHTML = step.btnText;
        
        // Render step-by-step instructions to unblock based on whether it is an installed PWA or normal browser tab
        const helperContainer = document.getElementById('permission-helper-container');
        if (helperContainer) {
          if (step.id === 'location') {
            if (isStandalone) {
              helperContainer.innerHTML = `
                <div class="permission-guide page-enter" style="margin-top: 16px; padding: 16px; background: #FFF5F5; border: 1px dashed #FEB2B2; border-radius: 16px; text-align: left; font-size: 14px; color: #9B2C2C; animation: fadeInUp 0.4s ease;">
                  <div style="display: flex; gap: 8px; align-items: flex-start; margin-bottom: 8px;">
                    <span style="font-size: 18px;">📱</span>
                    <strong>Ubicación bloqueada en la App PWA:</strong>
                  </div>
                  <ol style="margin: 0; padding-left: 20px; line-height: 1.5; color: #742A2A;">
                    <li>Si usas <strong>Android</strong>: Mantén presionado el ícono de la app <strong>GoDelivery</strong> en la pantalla de tu celular, selecciona <strong>"Información de la aplicación"</strong> (ícono de la letra ⓘ), ve a <strong>"Permisos"</strong> y activa la <strong>Ubicación</strong>.</li>
                    <li>Si usas <strong>iPhone (iOS)</strong>: Abre los <strong>Ajustes generales</strong> de tu iPhone, busca <strong>GoDelivery</strong> en la lista de aplicaciones abajo del todo y activa la <strong>Localización</strong>.</li>
                    <li>Si usas <strong>PC</strong>: Abre la configuración del navegador y restablece los permisos del sitio.</li>
                    <li>Vuelve a la app y presiona <strong>"Continuar"</strong>.</li>
                  </ol>
                </div>
              `;
            } else {
              helperContainer.innerHTML = `
                <div class="permission-guide page-enter" style="margin-top: 16px; padding: 16px; background: #FFF5F5; border: 1px dashed #FEB2B2; border-radius: 16px; text-align: left; font-size: 14px; color: #9B2C2C; animation: fadeInUp 0.4s ease;">
                  <div style="display: flex; gap: 8px; align-items: flex-start; margin-bottom: 8px;">
                    <span style="font-size: 18px;">🔒</span>
                    <strong>Ubicación bloqueada en el navegador:</strong>
                  </div>
                  <ol style="margin: 0; padding-left: 20px; line-height: 1.5; color: #742A2A;">
                    <li>Toca el ícono de <strong>ajustes / candado</strong> a la izquierda de la URL (en la barra de direcciones superior).</li>
                    <li>Busca <strong>Ubicación</strong> y cámbialo a <strong>"Permitir"</strong>.</li>
                    <li>Vuelve aquí y presiona <strong>"Continuar"</strong>.</li>
                  </ol>
                </div>
              `;
            }
          } else if (step.id === 'notifications') {
            if (isStandalone) {
              helperContainer.innerHTML = `
                <div class="permission-guide page-enter" style="margin-top: 16px; padding: 16px; background: #FFF5F5; border: 1px dashed #FEB2B2; border-radius: 16px; text-align: left; font-size: 14px; color: #9B2C2C; animation: fadeInUp 0.4s ease;">
                  <div style="display: flex; gap: 8px; align-items: flex-start; margin-bottom: 8px;">
                    <span style="font-size: 18px;">🔔</span>
                    <strong>Notificaciones bloqueadas en la App PWA:</strong>
                  </div>
                  <ol style="margin: 0; padding-left: 20px; line-height: 1.5; color: #742A2A;">
                    <li>Si usas <strong>Android</strong>: Mantén presionado el ícono de la app <strong>GoDelivery</strong> en la pantalla de tu celular, selecciona <strong>"Información de la aplicación"</strong> (ícono de la letra ⓘ), ve a <strong>"Permisos"</strong> y activa las <strong>Notificaciones</strong>.</li>
                    <li>Si usas <strong>iPhone (iOS)</strong>: Abre los <strong>Ajustes generales</strong> de tu iPhone, busca <strong>GoDelivery</strong> en la lista de aplicaciones abajo del todo y activa las <strong>Notificaciones</strong>.</li>
                    <li>Vuelve a la app y presiona <strong>"Activar ahora"</strong>.</li>
                  </ol>
                </div>
              `;
            } else {
              helperContainer.innerHTML = `
                <div class="permission-guide page-enter" style="margin-top: 16px; padding: 16px; background: #FFF5F5; border: 1px dashed #FEB2B2; border-radius: 16px; text-align: left; font-size: 14px; color: #9B2C2C; animation: fadeInUp 0.4s ease;">
                  <div style="display: flex; gap: 8px; align-items: flex-start; margin-bottom: 8px;">
                    <span style="font-size: 18px;">🔔</span>
                    <strong>Notificaciones bloqueadas en el navegador:</strong>
                  </div>
                  <ol style="margin: 0; padding-left: 20px; line-height: 1.5; color: #742A2A;">
                    <li>Toca el ícono de <strong>ajustes / candado</strong> a la izquierda de la URL (en la barra de direcciones superior).</li>
                    <li>Busca <strong>Notificaciones</strong> y cámbialo a <strong>"Permitir"</strong>.</li>
                    <li>Vuelve aquí y presiona <strong>"Activar ahora"</strong>.</li>
                  </ol>
                </div>
              `;
            }
          }
        }
      }
    };
  };

  document.body.appendChild(container);
  renderStep();
}

