import { showToast } from '../components/toast.js';

let isUnlocked = true;
let audioCtx = null;
const audioCache = new Map();

// Helper to get or create the Web Audio API context safely
function getAudioContext() {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    try {
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      if (AudioCtxClass) {
        audioCtx = new AudioCtxClass();
      }
    } catch(e) {
      console.warn('[AudioManager] Failed to create AudioContext:', e);
      return null;
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

const synthLoops = new Map();

// Alarmas que el navegador no dejó sonar porque nadie tocó la página todavía (política de
// autoplay de Chrome/Safari en PC). Suenan apenas haya un clic o una tecla.
const blockedLoops = new Map(); // url -> volume
const wantedLoops = new Set();   // alarmas que deberían estar sonando ahora
let gestureHooked = false;
let audioBlocked = false;
let audioPlayed = false;           // ya sonó algo: el navegador deja reproducir

function setBlocked(v) {
  if (audioBlocked === v) return;
  audioBlocked = v;
  try { window.dispatchEvent(new CustomEvent('go-audio-blocked', { detail: { blocked: v } })); } catch (e) {}
}

function hookFirstGesture() {
  if (gestureHooked || typeof window === 'undefined') return;
  gestureHooked = true;
  const events = ['pointerdown', 'keydown', 'touchend'];
  const onGesture = () => {
    events.forEach(ev => window.removeEventListener(ev, onGesture, true));
    gestureHooked = false;
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    const pending = [...blockedLoops.entries()];
    blockedLoops.clear();
    setBlocked(false);
    pending.forEach(([url, vol]) => AudioManager.startLoop(url, vol));
  };
  events.forEach(ev => window.addEventListener(ev, onGesture, true));
}

// iPhone: con el botón de silencio puesto el WebView calla el audio "ambiente". Mientras
// suena una alarma se pide la sesión de reproducción (Safari/WKWebView 16.4+), como una
// alarma de verdad; al apagarse vuelve a 'auto' para no cortar la música de nadie.
function setAlarmSession(on) {
  try {
    const s = navigator.audioSession;
    if (!s) return;
    const want = on ? 'playback' : 'auto';
    if (s.type !== want) s.type = want;
  } catch (e) {}
}

// Si el sistema corta la alarma (llamada, otra app, la app pasó a segundo plano) y sigue
// habiendo motivo para sonar, vuelve a arrancar en cuanto se pueda.
function resumeWantedLoops() {
  wantedLoops.forEach(url => {
    const audio = audioCache.get(url + '_loop');
    if (audio && audio.paused && !blockedLoops.has(url)) {
      setAlarmSession(true);
      audio.play().catch(() => {});
    }
  });
}
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') setTimeout(resumeWantedLoops, 300);
  });
  window.addEventListener('pageshow', () => setTimeout(resumeWantedLoops, 300));
}

function getLoopAudio(url) {
  let audio = audioCache.get(url + '_loop');
  if (audio) return audio;
  const fullUrl = url.startsWith('http') ? url : window.location.origin + url;
  audio = new Audio(fullUrl);
  audio.loop = true;
  audio.preload = 'auto';
  audio.addEventListener('pause', () => {
    if (!wantedLoops.has(url)) return;
    setTimeout(() => {
      if (wantedLoops.has(url) && audio.paused && document.visibilityState === 'visible') resumeWantedLoops();
    }, 1500);
  });
  audioCache.set(url + '_loop', audio);
  return audio;
}

const isAutoplayBlock = (err) => err && (err.name === 'NotAllowedError' || /user (didn't|did not) interact|gesture/i.test(err.message || ''));

export const AudioManager = {
  init() {
    // Avoid pre-emptively playing silent audio on user interaction to prevent stealing audio focus from background players like Spotify.
    // Web Audio API context will be created and resumed dynamically on demand when a sound is actually played.
    isUnlocked = true;
  },

  /**
   * Deja lista la alarma con el primer clic/tecla: Safari sólo deja sonar más tarde (sin
   * gesto) un audio que ya se reprodujo una vez dentro de un gesto.
   */
  primeLoop(url) {
    if (!url || typeof window === 'undefined') return;
    const events = ['pointerdown', 'keydown', 'touchend'];
    const onGesture = () => {
      events.forEach(ev => window.removeEventListener(ev, onGesture, true));
      try {
        const audio = getLoopAudio(url);
        if (!audio.paused) return;
        audio.muted = true;
        audio.play().then(() => {
          // Si mientras tanto alguien pidió que suene, no se corta
          if (!wantedLoops.has(url)) { audio.pause(); audio.currentTime = 0; }
          audio.muted = false;
        }).catch(() => { audio.muted = false; });
      } catch (e) {}
      getAudioContext();
    };
    events.forEach(ev => window.addEventListener(ev, onGesture, true));
  },

  /** true si el navegador todavía no deja sonar nada (falta un clic en la página). */
  isAudioBlocked() {
    if (audioBlocked) return true;
    if (audioPlayed) return false;
    // La app nativa deja sonar sin gesto (Capacitor lo habilita en el WebView)
    if (window.Capacitor?.isNativePlatform?.()) return false;
    try {
      const ua = navigator.userActivation;
      return !!ua && !ua.hasBeenActive;
    } catch (e) { return false; }
  },

  /**
   * Synthesizes a satisfying "bubble pop" sound (ideal for adding items to the cart).
   * Upward frequency sweep with exponential decay.
   */
  playSynthPop() {
    this.hapticLight();
    try {
      const ctx = getAudioContext();
      if (!ctx) return;

      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();

      osc.connect(gainNode);
      gainNode.connect(ctx.destination);

      osc.type = 'sine';
      
      // Smooth frequency sweep from 250Hz to 750Hz in 0.08 seconds
      osc.frequency.setValueAtTime(250, now);
      osc.frequency.exponentialRampToValueAtTime(750, now + 0.08);

      // Volume envelope: instant attack, fast exponential decay
      gainNode.gain.setValueAtTime(0.001, now);
      gainNode.gain.exponentialRampToValueAtTime(0.12, now + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

      osc.start(now);
      osc.stop(now + 0.08);
    } catch (err) {
      console.warn('SynthPop failed:', err);
    }
  },

  /**
   * Synthesizes an elegant, rich two-tone chime celebration (ideal for checkout success / level up).
   * Generates a harmonic C5 (523.25Hz) and E5 (659.25Hz) arpeggio.
   */
  playSynthChime() {
    this.hapticSuccess();
    try {
      const ctx = getAudioContext();
      if (!ctx) return;

      const now = ctx.currentTime;

      // Note 1: C5 (523.25 Hz)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.type = 'triangle'; // triangle wave gives a warmer, bell-like tone
      osc1.frequency.setValueAtTime(523.25, now);
      
      gain1.gain.setValueAtTime(0.001, now);
      gain1.gain.exponentialRampToValueAtTime(0.08, now + 0.03);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

      osc1.start(now);
      osc1.stop(now + 0.5);

      // Note 2: E5 (659.25 Hz) slightly delayed by 70ms
      const delay = 0.07;
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.type = 'sine'; // sine wave blends nicely for the higher frequency
      osc2.frequency.setValueAtTime(659.25, now + delay);

      gain2.gain.setValueAtTime(0.001, now + delay);
      gain2.gain.exponentialRampToValueAtTime(0.08, now + delay + 0.03);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.65);

      osc2.start(now + delay);
      osc2.stop(now + delay + 0.65);
    } catch (err) {
      console.warn('SynthChime failed:', err);
    }
  },

  /**
   * Synthesizes a soft, quick upward chirp for sending chat messages.
   */
  playSynthMessageSend() {
    this.hapticLight();
    try {
      const ctx = getAudioContext();
      if (!ctx) return;

      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();

      osc.connect(gainNode);
      gainNode.connect(ctx.destination);

      osc.type = 'sine';
      osc.frequency.setValueAtTime(450, now);
      osc.frequency.exponentialRampToValueAtTime(900, now + 0.06);

      gainNode.gain.setValueAtTime(0.001, now);
      gainNode.gain.exponentialRampToValueAtTime(0.06, now + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

      osc.start(now);
      osc.stop(now + 0.06);
    } catch (err) {
      console.warn('SynthMessageSend failed:', err);
    }
  },

  /**
   * Synthesizes a gentle two-step downward chirp for receiving chat messages.
   */
  playSynthMessageReceive() {
    this.hapticMedium();
    try {
      const ctx = getAudioContext();
      if (!ctx) return;

      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();

      osc.connect(gainNode);
      gainNode.connect(ctx.destination);

      osc.type = 'sine';
      osc.frequency.setValueAtTime(750, now);
      osc.frequency.exponentialRampToValueAtTime(400, now + 0.08);

      gainNode.gain.setValueAtTime(0.001, now);
      gainNode.gain.exponentialRampToValueAtTime(0.06, now + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

      osc.start(now);
      osc.stop(now + 0.08);
    } catch (err) {
      console.warn('SynthMessageReceive failed:', err);
    }
  },

  /**
   * Synthesizes a beautiful notification chime chord (E5 -> G5 -> C6).
   */
  playSynthNotification() {
    this.hapticSuccess();
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      
      const tones = [659.25, 783.99, 1046.50];
      tones.forEach((freq, idx) => {
        const delay = idx * 0.08;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + delay);
        
        gain.gain.setValueAtTime(0.001, now + delay);
        gain.gain.exponentialRampToValueAtTime(0.06, now + delay + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.3);
        
        osc.start(now + delay);
        osc.stop(now + delay + 0.3);
      });
    } catch (err) {
      console.warn('SynthNotification failed:', err);
    }
  },

  playSound(url, volume = 1.0) {
    if (!url) return;

    if (!isUnlocked) {
      console.log('Audio blocked: Waiting for user interaction');
      return;
    }

    try {
      let audio = audioCache.get(url);
      if (!audio) {
        const fullUrl = url.startsWith('http') ? url : window.location.origin + url;
        console.log('🔈 Loading audio from:', fullUrl);
        audio = new Audio(fullUrl);
        audioCache.set(url, audio);
      }
      
      audio.currentTime = 0;
      audio.volume = volume;
      audio.play().catch(err => {
        // NotAllowedError = el navegador no deja sonar hasta que la persona toque la pantalla:
        // es normal, no un error de la app (no va al detector de errores)
        // AbortError = otro sonido o una pausa lo cortó (normal, tampoco va al detector)
        (err?.name === 'NotAllowedError' || err?.name === 'AbortError' ? console.warn : console.error)('Playback failed, falling back to synth chime:', err);
        this.playSynthNotification();
      });
    } catch (err) {
      console.error('Audio manager error, falling back to synth chime:', err);
      this.playSynthNotification();
    }
  },

  startLoop(url, volume = 1.0) {
    if (!url) return null;

    if (!isUnlocked) {
      console.log('Audio loop blocked: Waiting for user interaction');
      return null;
    }

    try {
      const audio = getLoopAudio(url);
      wantedLoops.add(url);
      setAlarmSession(true);
      // Si ya está sonando no se reinicia: cada cambio en los pedidos lo volvería a arrancar
      if (!audio.paused) { audio.volume = volume; audio.muted = false; return audio; }
      audio.currentTime = 0;
      audio.volume = volume;
      audio.play().then(() => {
        blockedLoops.delete(url);
        const first = !audioPlayed;
        audioPlayed = true;
        setBlocked(false);
        if (first) { try { window.dispatchEvent(new CustomEvent('go-audio-blocked', { detail: { blocked: false } })); } catch (e) {} }
        this.stopSynthLoop(url);
      }).catch(err => {
        if (isAutoplayBlock(err)) {
          // El sintetizador tampoco puede sonar sin un gesto: se espera el primer clic
          console.warn('[AudioManager] Alarma bloqueada por el navegador hasta que se toque la página');
          blockedLoops.set(url, volume);
          setBlocked(true);
          hookFirstGesture();
          return;
        }
        if (err?.name === 'AbortError') {
          // La cortó una pausa: si la alarma ya se apagó, no hay que reemplazarla por el sintetizador
          if (!wantedLoops.has(url)) return;
          console.warn('Playback loop interrupted, falling back to synth loop:', err);
        } else {
          console.error('Playback loop failed, falling back to synth loop:', err);
        }
        this.startSynthLoop(url);
      });
      return audio;
    } catch (err) {
      console.error('Audio loop error, falling back to synth loop:', err);
      this.startSynthLoop(url);
      return null;
    }
  },

  stopLoop(url) {
    if (!url) return;
    try {
      wantedLoops.delete(url);
      blockedLoops.delete(url);
      if (!blockedLoops.size) setBlocked(false);
      if (!wantedLoops.size) setAlarmSession(false);
      this.stopSynthLoop(url);
      const audio = audioCache.get(url + '_loop');
      if (audio) {
        audio.pause();
        audio.currentTime = 0;
        console.log('⏸ Stopped audio loop for:', url);
      }
    } catch (err) {
      console.error('Stop audio loop error:', err);
    }
  },

  /**
   * Loud POS kitchen buzzer for incoming merchant orders
   */
  playKitchenAlarmBuzzer() {
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      [0, 0.14, 0.28].forEach((offset) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'square';
        osc.frequency.setValueAtTime(880, now + offset);
        gain.gain.setValueAtTime(0.001, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.14, now + offset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.09);
        osc.start(now + offset);
        osc.stop(now + offset + 0.09);
      });
    } catch (e) {}
  },

  startSynthLoop(url) {
    if (synthLoops.has(url)) return;
    this.playKitchenAlarmBuzzer();
    const intervalId = setInterval(() => {
      this.playKitchenAlarmBuzzer();
    }, 1800);
    synthLoops.set(url, intervalId);
  },

  stopSynthLoop(url) {
    const intervalId = synthLoops.get(url);
    if (intervalId) {
      clearInterval(intervalId);
      synthLoops.delete(url);
      console.log('⏸ Stopped synthetic loop for:', url);
    }
  },
  
  vibrate(pattern = [200, 100, 200]) {
    if (!navigator.vibrate) return;
    
    try {
      navigator.vibrate(pattern);
    } catch (err) {
      console.warn('Vibration failed:', err);
    }
  },

  playArrivalChime() {
    this.hapticSuccess();
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      // Note 1: E5 (659.25 Hz)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.type = 'triangle';
      osc1.frequency.setValueAtTime(659.25, now);
      gain1.gain.setValueAtTime(0.001, now);
      gain1.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
      osc1.start(now);
      osc1.stop(now + 0.4);

      // Note 2: G5 (783.99 Hz) at +90ms
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(783.99, now + 0.09);
      gain2.gain.setValueAtTime(0.001, now + 0.09);
      gain2.gain.exponentialRampToValueAtTime(0.12, now + 0.11);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
      osc2.start(now + 0.09);
      osc2.stop(now + 0.5);

      // Note 3: C6 (1046.50 Hz) at +180ms
      const osc3 = ctx.createOscillator();
      const gain3 = ctx.createGain();
      osc3.connect(gain3);
      gain3.connect(ctx.destination);
      osc3.type = 'sine';
      osc3.frequency.setValueAtTime(1046.50, now + 0.18);
      gain3.gain.setValueAtTime(0.001, now + 0.18);
      gain3.gain.exponentialRampToValueAtTime(0.14, now + 0.20);
      gain3.gain.exponentialRampToValueAtTime(0.001, now + 0.85);
      osc3.start(now + 0.18);
      osc3.stop(now + 0.85);
    } catch (err) {
      console.warn('ArrivalChime failed:', err);
    }
  },

  /**
   * High-end, modern, crisp single radar chime for incoming driver offers (Uber/DoorDash caliber)
   */
  playDriverRadarPing() {
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      // Note 1: A5 (880 Hz) - Crisp initial ping
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.type = 'triangle';
      osc1.frequency.setValueAtTime(880, now);
      gain1.gain.setValueAtTime(0.001, now);
      gain1.gain.exponentialRampToValueAtTime(0.18, now + 0.015);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      osc1.start(now);
      osc1.stop(now + 0.25);

      // Note 2: E6 (1318.5 Hz) - Ascending harmonic at +90ms
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(1318.5, now + 0.09);
      gain2.gain.setValueAtTime(0.001, now + 0.09);
      gain2.gain.exponentialRampToValueAtTime(0.20, now + 0.105);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
      osc2.start(now + 0.09);
      osc2.stop(now + 0.45);

      // Note 3: A6 (1760 Hz) - Crystalline top accent at +180ms
      const osc3 = ctx.createOscillator();
      const gain3 = ctx.createGain();
      osc3.connect(gain3);
      gain3.connect(ctx.destination);
      osc3.type = 'sine';
      osc3.frequency.setValueAtTime(1760, now + 0.18);
      gain3.gain.setValueAtTime(0.001, now + 0.18);
      gain3.gain.exponentialRampToValueAtTime(0.16, now + 0.195);
      gain3.gain.exponentialRampToValueAtTime(0.001, now + 0.65);
      osc3.start(now + 0.18);
      osc3.stop(now + 0.65);
    } catch (err) {
      console.warn('DriverRadarPing failed:', err);
    }
  },

  startDriverOfferLoop() {
    if (synthLoops.has('driver_offer_alert')) return;
    this.playDriverRadarPing();
    const intervalId = setInterval(() => {
      this.playDriverRadarPing();
    }, 2200);
    synthLoops.set('driver_offer_alert', intervalId);
  },

  stopDriverOfferLoop() {
    const intervalId = synthLoops.get('driver_offer_alert');
    if (intervalId) {
      clearInterval(intervalId);
      synthLoops.delete('driver_offer_alert');
    }
  },

  hapticLight() {
    this.vibrate([30]);
  },

  hapticMedium() {
    this.vibrate([65]);
  },

  hapticSuccess() {
    this.vibrate([50, 40, 90]);
  },

  hapticError() {
    this.vibrate([90, 50, 90, 50, 120]);
  }
};
