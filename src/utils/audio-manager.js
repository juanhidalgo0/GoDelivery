import { showToast } from '../components/toast.js';

let isUnlocked = false;
let audioCtx = null;
const audioCache = new Map();

// Helper to get or create the Web Audio API context
function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

const synthLoops = new Map();

export const AudioManager = {
  init() {
    const unlock = () => {
      if (isUnlocked) return;
      
      // Create and play a silent buffer to unlock standard Audio
      const silentAudio = new Audio();
      silentAudio.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==';
      silentAudio.play().then(() => {
        isUnlocked = true;
        console.log('🔊 Audio System Unlocked');
        
        // Also unlock Web Audio API AudioContext
        try {
          const ctx = getAudioContext();
          if (ctx) {
            console.log('🎵 Web Audio API Context Active:', ctx.state);
          }
        } catch (e) {
          console.warn('Web Audio API activation deferred:', e);
        }

        window.removeEventListener('click', unlock);
        window.removeEventListener('touchstart', unlock);
      }).catch(err => {
        console.warn('Audio unlock failed:', err);
      });
    };

    window.addEventListener('click', unlock, { once: false });
    window.addEventListener('touchstart', unlock, { once: false });
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
        console.error('Playback failed, falling back to synth chime:', err);
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
      let audio = audioCache.get(url + '_loop');
      if (!audio) {
        const fullUrl = url.startsWith('http') ? url : window.location.origin + url;
        console.log('🔁 Loading loop audio from:', fullUrl);
        audio = new Audio(fullUrl);
        audio.loop = true;
        audioCache.set(url + '_loop', audio);
      }
      
      audio.currentTime = 0;
      audio.volume = volume;
      audio.play().catch(err => {
        console.error('Playback loop failed, falling back to synth loop:', err);
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

  startSynthLoop(url) {
    if (synthLoops.has(url)) return;
    this.playSynthNotification();
    const intervalId = setInterval(() => {
      this.playSynthNotification();
    }, 1500);
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
