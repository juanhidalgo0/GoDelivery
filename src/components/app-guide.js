/* GoDelivery — Interactive App Guide Component
   Premium animated slideshow that teaches users the full app experience */
import { icon } from '../utils/icons.js';

const GUIDE_STORAGE_KEY = 'gd-app-guide-seen-v2';

// ── Slide Data ──
const SLIDES = [
  {
    id: 'welcome',
    emoji: '<img src="/logo-pwa.png" style="width:72px;height:72px;object-fit:contain;border-radius:18px;" />',
    iconBg: 'linear-gradient(135deg, rgba(225,29,72,0.2), rgba(225,29,72,0.05))',
    title: '¡Bienvenido a GoDelivery!',
    subtitle: 'Tu app todo-en-uno para pedir comida, productos, viajes y mucho más. Vamos a enseñarte cómo sacarle el máximo provecho.',
    type: 'features',
    features: [
      { icon: '🛒', bg: 'rgba(16,185,129,0.15)', label: 'Pedidos a comercios', desc: 'Comida, productos y más directo a tu puerta.' },
      { icon: '🏍️', bg: 'rgba(59,130,246,0.15)', label: 'Go Favor', desc: 'Mandados, encomiendas y Go Cash.' },
      { icon: '🚗', bg: 'rgba(168,85,247,0.15)', label: 'Go Viajes', desc: 'Traslados en moto o auto a donde necesites.' },
      { icon: '⭐', bg: 'rgba(245,158,11,0.15)', label: 'GO Points', desc: 'Sumás puntos en cada compra y los canjeás.' }
    ]
  },
  {
    id: 'search',
    emoji: '🔍',
    iconBg: 'linear-gradient(135deg, rgba(59,130,246,0.2), rgba(59,130,246,0.05))',
    title: 'Buscar Productos y Comercios',
    subtitle: 'Encontrá todo lo que necesitás en segundos.',
    type: 'steps',
    steps: [
      { title: 'Barra de búsqueda', desc: 'Escribí el nombre de un producto, comercio o categoría en la barra superior.' },
      { title: 'Resultados instantáneos', desc: 'Verás sugerencias de productos y comercios mientras escribís.' },
      { title: 'Explorá categorías', desc: 'Deslizá las categorías (Comida, Bebidas, Farmacia, etc.) para filtrar.' },
      { title: 'Ingresá al comercio', desc: 'Tocá un comercio para ver su catálogo completo y sus precios.' }
    ]
  },
  {
    id: 'order',
    emoji: '🛒',
    iconBg: 'linear-gradient(135deg, rgba(16,185,129,0.2), rgba(16,185,129,0.05))',
    title: '¿Cómo Hacer un Pedido?',
    subtitle: 'Paso a paso para pedir a un comercio.',
    type: 'steps',
    steps: [
      { title: 'Elegí tus productos', desc: 'Abrí un comercio, seleccioná productos y agregalos al carrito con la cantidad deseada.' },
      { title: 'Revisá tu carrito', desc: 'Tocá el ícono del carrito para ver tu pedido, modificar cantidades o agregar observaciones.' },
      { title: 'Confirmá tu dirección', desc: 'Verificá que la dirección de entrega sea correcta o ingresá una nueva.' },
      { title: 'Enviá el pedido', desc: 'Presioná "Confirmar Pedido". El pago se realiza en efectivo o transferencia al delivery.' }
    ]
  },
  {
    id: 'tracking',
    emoji: '📦',
    iconBg: 'linear-gradient(135deg, rgba(245,158,11,0.2), rgba(245,158,11,0.05))',
    title: 'Seguimiento de tu Pedido',
    subtitle: 'Conocé cada etapa de tu pedido en tiempo real.',
    type: 'steps',
    steps: [
      { title: '1. El comercio recibe tu pedido', desc: 'El local debe confirmar que acepta preparar tu pedido. Recibirás una notificación.' },
      { title: '2. Un delivery lo toma', desc: 'Un repartidor disponible acepta llevar tu pedido. Podrás ver quién es.' },
      { title: '3. En camino a vos', desc: 'El delivery recoge los productos y se dirige a tu dirección. Seguí su avance en el mapa.' },
      { title: '4. Código de entrega', desc: 'Al llegar, el delivery te pedirá un código de entrega que recibirás en la app. ¡Confirmalo y listo!' }
    ]
  },
  {
    id: 'gofavor',
    emoji: '🏍️',
    iconBg: 'linear-gradient(135deg, rgba(168,85,247,0.2), rgba(168,85,247,0.05))',
    title: 'Go Favor: Mandados y Más',
    subtitle: 'Pedí lo que necesites, nosotros lo llevamos.',
    type: 'features',
    features: [
      { icon: '📋', bg: 'rgba(168,85,247,0.15)', label: 'Mandado', desc: 'Pedí que te compren algo en cualquier lugar. Describí lo que necesitás y un delivery lo busca.' },
      { icon: '📦', bg: 'rgba(59,130,246,0.15)', label: 'Encomienda', desc: 'Enviá un paquete de un punto a otro de la ciudad. Retiro y entrega puerta a puerta.' },
      { icon: '💰', bg: 'rgba(16,185,129,0.15)', label: 'Go Cash', desc: 'Enviá o recibí dinero/transferencia al instante! Un delivery va hasta a tu casa a hacer la transacción.' }
    ]
  },
  {
    id: 'goviajes',
    emoji: '🚕',
    iconBg: 'linear-gradient(135deg, rgba(59,130,246,0.2), rgba(59,130,246,0.05))',
    title: 'Go Viajes',
    subtitle: 'Solicitá un traslado cómodo y seguro.',
    type: 'steps',
    steps: [
      { title: 'Elegí origen y destino', desc: 'Ingresá tu punto de partida y la dirección a la que querés ir.' },
      { title: 'Seleccioná el vehículo', desc: 'Elegí entre Moto (más económico) o Auto (más cómodo). Verás el precio estimado.' },
      { title: 'Confirmá el viaje', desc: 'Un chofer habilitado recibirá tu solicitud y la aceptará.' },
      { title: 'Viajá tranquilo', desc: 'El chofer te busca en tu ubicación. El pago se realiza en efectivo o transferencia al chofer.' }
    ]
  },
  {
    id: 'points',
    emoji: '🏆',
    iconBg: 'linear-gradient(135deg, rgba(245,158,11,0.2), rgba(245,158,11,0.05))',
    title: 'GO Points: Tu Programa de Recompensas',
    subtitle: 'Cada compra te acerca a premios increíbles.',
    type: 'features',
    features: [
      { icon: '🪙', bg: 'rgba(245,158,11,0.15)', label: 'Ganás puntos al comprar', desc: 'Por cada pedido confirmado y entregado sumás GO Points automáticamente.' },
      { icon: '🎁', bg: 'rgba(225,29,72,0.15)', label: 'Canjealos por premios', desc: 'Accedé al catálogo de recompensas y canjeá tus puntos por descuentos y productos.' },
      { icon: '📈', bg: 'rgba(16,185,129,0.15)', label: 'Subí de nivel', desc: 'Mientras más usés la app, más puntos acumulás. ¡Alcanzá los niveles más altos!' },
      { icon: '🤝', bg: 'rgba(59,130,246,0.15)', label: 'Invitá amigos', desc: 'Compartí tu código de referido y ambos reciben puntos extra cuando se registran.' }
    ]
  }
];

// ── Render Helpers ──

function renderProgressBar(currentStep) {
  return `<div class="app-guide-progress">
    ${SLIDES.map((_, i) => `
      <div class="app-guide-progress-segment ${i < currentStep ? 'completed' : ''} ${i === currentStep ? 'active' : ''}"></div>
    `).join('')}
  </div>`;
}

function renderFeatures(features) {
  return `<div class="app-guide-features">
    ${features.map(f => `
      <div class="app-guide-feature">
        <div class="app-guide-feature-icon" style="background:${f.bg};">${f.icon}</div>
        <div class="app-guide-feature-text">
          <strong>${f.label}</strong>
          <span>${f.desc}</span>
        </div>
      </div>
    `).join('')}
  </div>`;
}

function renderSteps(steps) {
  return `<div class="app-guide-step-flow">
    ${steps.map((s, i) => `
      <div class="app-guide-step-item">
        <div class="app-guide-step-num">${i + 1}</div>
        <div class="app-guide-step-content">
          <strong>${s.title}</strong>
          <span>${s.desc}</span>
        </div>
      </div>
    `).join('')}
  </div>`;
}

function renderSlide(slide, stepIndex, direction) {
  const dirClass = direction === 'forward' ? 'slide-in-right' : 'slide-in-left';
  const bodyContent = slide.type === 'features' ? renderFeatures(slide.features) : renderSteps(slide.steps);

  return `
    <div class="app-guide-slide ${dirClass}" id="guide-slide-active">
      <div class="app-guide-icon" style="background:${slide.iconBg};">${slide.emoji}</div>
      <h2 class="app-guide-title">${slide.title}</h2>
      <p class="app-guide-subtitle">${slide.subtitle}</p>
      ${bodyContent}
    </div>
  `;
}

// ── Main Guide Logic ──

export function showAppGuide(onComplete, isReplay = false) {
  // Check if already seen
  if (!isReplay && localStorage.getItem(GUIDE_STORAGE_KEY)) {
    showGuideFab();
    if (onComplete) onComplete();
    return;
  }

  let currentStep = 0;

  const overlay = document.createElement('div');
  overlay.className = 'app-guide-overlay';
  overlay.id = 'app-guide-overlay';

  function render(direction = 'forward') {
    const slide = SLIDES[currentStep];
    const isFirst = currentStep === 0;
    const isLast = currentStep === SLIDES.length - 1;

    overlay.innerHTML = `
      <div class="app-guide-card">
        ${isReplay ? `
          <button class="guide-close-btn" id="guide-close-btn" style="position: absolute; top: 14px; right: 16px; width: 32px; height: 32px; border-radius: 50%; background: rgba(0,0,0,0.06); border: none; display: flex; align-items: center; justify-content: center; color: #4b5563; cursor: pointer; z-index: 10;">
            ${icon('close', 18)}
          </button>
        ` : ''}
        ${renderProgressBar(currentStep)}
        ${renderSlide(slide, currentStep, direction)}
        <div class="app-guide-step-counter">${currentStep + 1} de ${SLIDES.length}</div>
        <div class="app-guide-footer">
          ${!isFirst ? `
            <button class="guide-btn-back" id="guide-back-btn">
              ${icon('chevronLeft', 20)}
            </button>
          ` : ''}
          <button class="guide-btn-next" id="guide-next-btn">
            ${isLast ? '¡Empezar a usar la App!' : 'Siguiente'}
            ${!isLast ? icon('chevronRight', 18) : icon('zap', 18)}
          </button>
        </div>
      </div>
    `;

    // Bind events
    const nextBtn = overlay.querySelector('#guide-next-btn');
    const backBtn = overlay.querySelector('#guide-back-btn');
    const closeBtn = overlay.querySelector('#guide-close-btn');

    if (closeBtn) {
      closeBtn.onclick = () => {
        overlay.classList.add('closing');
        setTimeout(() => {
          overlay.remove();
          showGuideFab();
          if (onComplete) onComplete();
        }, 500);
      };
    }

    if (nextBtn) {
      nextBtn.onclick = () => {
        if (currentStep < SLIDES.length - 1) {
          currentStep++;
          render('forward');
        } else {
          // Finish
          finishGuide();
        }
      };
    }

    if (backBtn) {
      backBtn.onclick = () => {
        if (currentStep > 0) {
          currentStep--;
          render('backward');
        }
      };
    }
  }

  function finishGuide() {
    localStorage.setItem(GUIDE_STORAGE_KEY, 'true');
    overlay.classList.add('closing');
    setTimeout(() => {
      overlay.remove();
      showGuideFab();
      if (onComplete) onComplete();
    }, 500);
  }

  // Prevent accidental swipe-back on iOS
  overlay.addEventListener('touchmove', (e) => {
    // Allow scrolling inside slide but prevent page navigation
  }, { passive: true });

  // Swipe support
  let touchStartX = 0;
  let touchEndX = 0;

  overlay.addEventListener('touchstart', (e) => {
    touchStartX = e.changedTouches[0].screenX;
  }, { passive: true });

  overlay.addEventListener('touchend', (e) => {
    touchEndX = e.changedTouches[0].screenX;
    const diff = touchStartX - touchEndX;
    if (Math.abs(diff) > 60) {
      if (diff > 0 && currentStep < SLIDES.length - 1) {
        // Swipe left → next
        currentStep++;
        render('forward');
      } else if (diff < 0 && currentStep > 0) {
        // Swipe right → back
        currentStep--;
        render('backward');
      }
    }
  }, { passive: true });

  document.body.appendChild(overlay);
  render('forward');
}

// ── Floating Action Button ──

export function showGuideFab() {
  // Remove existing FAB if any
  document.getElementById('app-guide-fab')?.remove();

  const fab = document.createElement('button');
  fab.id = 'app-guide-fab';
  fab.className = 'app-guide-fab attention';
  fab.title = 'Guía de la App';
  fab.innerHTML = icon('info', 24);

  fab.onclick = () => {
    // Re-show the guide in replay mode
    document.getElementById('app-guide-fab')?.remove();
    showAppGuide(null, true);
  };

  document.body.appendChild(fab);

  // Initial visibility check (must be visible only on the home page '/')
  const currentHash = window.location.hash.slice(1).split('?')[0] || '/';
  if (currentHash === '/' || currentHash === '') {
    fab.style.display = 'flex';
  } else {
    fab.style.display = 'none';
  }

  // Remove the attention pulse after 6 seconds
  setTimeout(() => {
    fab.classList.remove('attention');
  }, 6000);
}

// Global listener to toggle FAB visibility based on the active page
if (typeof window !== 'undefined' && !window._gdGuideFabListenerAdded) {
  window._gdGuideFabListenerAdded = true;
  window.addEventListener('hashchange', () => {
    const fab = document.getElementById('app-guide-fab');
    if (fab) {
      const hash = window.location.hash.slice(1).split('?')[0] || '/';
      if (hash === '/' || hash === '') {
        fab.style.display = 'flex';
      } else {
        fab.style.display = 'none';
      }
    }
  });
}

