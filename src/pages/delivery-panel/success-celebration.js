// Post-delivery success celebration (confetti + earnings count-up) for the driver panel.
// Extracted from delivery-panel.js so this code is only fetched/parsed when a
// delivery is actually completed, instead of on every panel load.
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../../firebase.js';
import { getState } from '../../state.js';
import { formatPrice } from '../../utils/format.js';
import { icon } from '../../utils/icons.js';
import { getDriverMapTheme } from '../../components/driver-navigation-map.js';
import { getOrderDriverEarnings } from '../delivery-panel.js';

export async function showSuccessCelebration(orders, onFinish) {
  const isLight = getDriverMapTheme() === 'light';
  const user = getState().user;
  const currentSessionId = user?.currentSessionId;
  let previousSessionEarned = 0;
  let currentDebt = orders.reduce((sum, o) => sum + (o.appUsageFee || 0), 0);

  const totalEarned = orders.reduce((sum, o) => {
    return sum + getOrderDriverEarnings(o);
  }, 0);

  if (currentSessionId) {
    try {
      const q = query(
        collection(db, 'orders'),
        where('driverId', '==', user.uid),
        where('deliverySessionId', '==', currentSessionId),
        where('status', '==', 'completed')
      );
      const snap = await getDocs(q);
      let totalCompletedInSession = 0;
      snap.docs.forEach(d => {
        const o = d.data();
        const netEarnings = getOrderDriverEarnings(o);
        totalCompletedInSession += netEarnings;
      });

      const currentOrderIds = orders.map(o => o.id);
      let currentOrdersSessionEarnings = 0;
      snap.docs.forEach(d => {
        if (currentOrderIds.includes(d.id)) {
          const o = d.data();
          const netEarnings = getOrderDriverEarnings(o);
          currentOrdersSessionEarnings += netEarnings;
        }
      });
      previousSessionEarned = Math.max(0, totalCompletedInSession - currentOrdersSessionEarnings);
    } catch (e) {
      console.error('Error calculating session earnings for celebration:', e);
    }
  }

  const overlay = document.createElement('div');
  overlay.id = 'delivery-success-celebration';
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: #E11D48;
    z-index: 99999;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: #0f172a;
    font-family: var(--font-display, 'Outfit', sans-serif);
    opacity: 0;
    transition: opacity 0.5s cubic-bezier(0.19, 1, 0.22, 1);
    overflow: hidden;
  `;

  const previousDebt = Math.max(0, (getState().user?.deliveryDebt || 0) - currentDebt);

  overlay.innerHTML = `
    <!-- Expanding Morphing Sphere from Center -->
    <div class="celebration-circle-grow" style="
      position: absolute;
      width: 10px;
      height: 10px;
      background: ${isLight ? 'rgba(248, 250, 252, 1)' : '#090d16'};
      border-radius: 50%;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%) scale(0);
      transform-origin: center;
      animation: expandWhiteCircle 1.6s cubic-bezier(0.85, 0, 0.15, 1) forwards;
      z-index: 1;
      pointer-events: none;
    "></div>

    <canvas id="confetti-canvas" style="position:absolute; top:0; left:0; width:100%; height:100%; pointer-events:none; z-index: 2; opacity: 0; animation: fadeInConfetti 1s ease 1s forwards;"></canvas>
    
    <div style="text-align:center; z-index: 10; padding:36px 28px; max-width:400px; display:flex; flex-direction:column; align-items:center; gap:24px; width:92%; box-sizing:border-box; background: ${isLight ? 'white' : 'rgba(15, 23, 42, 0.95)'}; backdrop-filter: blur(20px); border: 1.5px solid ${isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.1)'}; border-radius: 36px; box-shadow: 0 30px 60px -15px ${isLight ? 'rgba(15, 23, 42, 0.12)' : 'rgba(0, 0, 0, 0.7)'}; transform: scale(0.9) translateY(20px); opacity: 0; animation: modalEntrance 0.8s cubic-bezier(0.19, 1, 0.22, 1) 0.5s forwards;">
      
      <!-- Brand Logo Header -->
      <div style="display: flex; flex-direction: column; align-items: center; gap: 8px; margin-bottom: 2px;">
        <img src="/logo-pwa.png" alt="Go! Delivery" onerror="this.onerror=null; this.src='/logo.png';" style="width: 86px; height: 86px; border-radius: 50%; object-fit: cover; filter: drop-shadow(0 6px 15px rgba(0, 0, 0, 0.25)); animation: bounceLogo 2.2s infinite ease-in-out;">
      </div>

      <div style="text-align: center; display: flex; flex-direction: column; gap: 6px;">
        <h1 style="font-size: 26px; font-weight: 950; margin: 0; letter-spacing: -0.8px; color: var(--driver-text-primary);">¡Entrega Completada!</h1>
        <p style="font-size: 14px; color: var(--driver-text-secondary); margin: 0; line-height: 1.45; font-weight: 600;">¡Excelente trabajo! Has sumado ganancias a tu cuenta.</p>
      </div>
      
      <div style="background: ${isLight ? '#f8fafc' : 'rgba(255, 255, 255, 0.04)'}; border: 1.5px solid ${isLight ? 'rgba(0,0,0,0.04)' : 'rgba(255, 255, 255, 0.08)'}; padding: 24px; border-radius: 28px; width: 100%; box-sizing: border-box; display: flex; flex-direction: column; gap: 16px; box-shadow: inset 0 2px 4px rgba(0,0,0,0.01);">
        <div style="text-align: center;">
          <span style="font-size: 10.5px; font-weight: 900; text-transform: uppercase; color: ${isLight ? '#0d9488' : '#2dd4bf'}; letter-spacing: 0.1em; display: block; margin-bottom: 4px;">Ganado en este viaje</span>
          <div id="celebration-amount" style="font-size: 40px; font-weight: 950; color: var(--driver-text-primary); letter-spacing: -1.5px; line-height: 1;">$ 0.00</div>
        </div>
        
        <div style="height: 1.5px; background: ${isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.08)'}; width: 100%;"></div>
        
        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 14px; font-weight: 800; color: var(--driver-text-secondary);">
          <span style="display: flex; align-items: center; gap: 8px;">${icon('briefcase', 15)} Total Sesión Actual</span>
          <span id="celebration-session-amount" style="font-size: 18px; font-weight: 950; color: var(--driver-text-primary); letter-spacing: -0.5px;">$ 0.00</span>
        </div>

        <div style="height: 1.5px; background: ${isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.08)'}; width: 100%;"></div>
        
        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 14px; font-weight: 800; color: var(--driver-accent-text);">
          <span style="display: flex; align-items: center; gap: 8px;">${icon('creditCard', 15)} Tarifa App a Rendir (Total)</span>
          <span id="celebration-debt-amount" style="font-size: 18px; font-weight: 950; color: var(--driver-accent-text); letter-spacing: -0.5px;">$ 0.00</span>
        </div>
      </div>

      <button id="celebration-continue-btn" style="
        background: linear-gradient(135deg, #E11D48 0%, #BE123C 100%); 
        color: white; 
        border: none; 
        padding: 18px 40px; 
        font-weight: 900; 
        font-size: 15px; 
        border-radius: 20px; 
        cursor: pointer; 
        box-shadow: 0 8px 25px rgba(225, 29, 72, 0.25);
        transition: all 0.3s cubic-bezier(0.19, 1, 0.22, 1);
        width: 100%;
        height: auto;
        letter-spacing: 0.05em;
        text-transform: uppercase;
      ">
        Entendido
      </button>
    </div>

    <style>
      @keyframes expandWhiteCircle {
        0% {
          transform: translate(-50%, -50%) scale(0);
        }
        100% {
          transform: translate(-50%, -50%) scale(350);
        }
      }
      @keyframes modalEntrance {
        to { transform: scale(1) translateY(0); opacity: 1; }
      }
      @keyframes fadeInConfetti {
        to { opacity: 1; }
      }
      @keyframes bounceLogo {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-6px); }
      }
      #celebration-continue-btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 12px 30px rgba(225, 29, 72, 0.35);
      }
      #celebration-continue-btn:active {
        transform: translateY(1px) scale(0.98);
        box-shadow: 0 4px 12px rgba(225, 29, 72, 0.2);
      }
    </style>
  `;

  document.body.appendChild(overlay);
  
  requestAnimationFrame(() => {
    overlay.style.opacity = '1';
  });

  const canvas = overlay.querySelector('#confetti-canvas');
  const ctx = canvas.getContext('2d');
  let animationFrameId;

  const resizeCanvas = () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  };
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  const confettiCount = 150;
  const confettiList = [];
  const colors = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

  for (let i = 0; i < confettiCount; i++) {
    confettiList.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height - canvas.height,
      r: Math.random() * 6 + 4,
      d: Math.random() * confettiCount,
      color: colors[Math.floor(Math.random() * colors.length)],
      tilt: Math.random() * 10 - 5,
      tiltAngleIncremental: (Math.random() * 0.07) + 0.05,
      tiltAngle: 0
    });
  }

  const drawConfetti = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < confettiCount; i++) {
      const p = confettiList[i];
      ctx.beginPath();
      ctx.lineWidth = p.r / 2;
      ctx.strokeStyle = p.color;
      ctx.moveTo(p.x + p.tilt + (p.r / 4), p.y);
      ctx.lineTo(p.x + p.tilt, p.y + p.tilt + (p.r / 4));
      ctx.stroke();
    }

    for (let i = 0; i < confettiCount; i++) {
      const p = confettiList[i];
      p.tiltAngle += p.tiltAngleIncremental;
      p.y += (Math.cos(p.d) + 3 + p.r / 2) / 2;
      p.x += Math.sin(p.d);
      p.tilt = Math.sin(p.tiltAngle - (i / 3)) * 15;

      if (p.y > canvas.height) {
        confettiList[i] = {
          x: Math.random() * canvas.width,
          y: -10,
          r: p.r,
          d: p.d,
          color: p.color,
          tilt: p.tilt,
          tiltAngleIncremental: p.tiltAngleIncremental,
          tiltAngle: p.tiltAngle
        };
      }
    }
    animationFrameId = requestAnimationFrame(drawConfetti);
  };
  drawConfetti();

  const amountEl = overlay.querySelector('#celebration-amount');
  const sessionAmountEl = overlay.querySelector('#celebration-session-amount');
  const debtAmountEl = overlay.querySelector('#celebration-debt-amount');
  
  sessionAmountEl.textContent = formatPrice(previousSessionEarned);
  if (debtAmountEl) {
    debtAmountEl.textContent = formatPrice(previousDebt);
  }

  let currentVal = 0;
  const duration = 1200;
  const stepTime = 20;
  const totalSteps = duration / stepTime;
  const stepAmount = totalEarned / totalSteps;

  const counterInterval = setInterval(() => {
    currentVal += stepAmount;
    let isDone = false;
    if (currentVal >= totalEarned) {
      currentVal = totalEarned;
      isDone = true;
    }
    amountEl.textContent = formatPrice(currentVal);
    sessionAmountEl.textContent = formatPrice(previousSessionEarned + currentVal);
    
    if (debtAmountEl) {
      const currentDebtVal = isDone ? (previousDebt + currentDebt) : (previousDebt + (currentVal / (totalEarned || 1)) * currentDebt);
      debtAmountEl.textContent = formatPrice(currentDebtVal);
    }
    
    if (isDone) {
      clearInterval(counterInterval);
    }
  }, stepTime);

  const cleanup = () => {
    cancelAnimationFrame(animationFrameId);
    window.removeEventListener('resize', resizeCanvas);
    clearInterval(counterInterval);
    overlay.style.opacity = '0';
    setTimeout(() => {
      overlay.remove();
      if (typeof onFinish === 'function') onFinish();
    }, 500);
  };

  overlay.querySelector('#celebration-continue-btn').addEventListener('click', cleanup);
}

