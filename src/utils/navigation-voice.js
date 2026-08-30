// Navigation Voice Guidance Engine (Text-to-Speech)
// Optimized for motorcycle and bike delivery drivers in Argentina / Latin America

let cachedVoice = null;
let lastSpokenText = '';
let lastSpokenTimestamp = 0;
let lastSpokenStageKey = '';

function findSpanishVoice() {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
  const voices = window.speechSynthesis.getVoices() || [];
  if (voices.length === 0) return null;

  const spanishVoices = voices.filter(v => v.lang && (v.lang.startsWith('es') || v.lang.includes('Spanish') || v.lang.includes('Español')));

  // 1. Highest Priority: Argentine Neural / Natural Female voices (Edge Microsoft Jimena, Google es-AR Neural, iOS Paulina/Luciana)
  const arNeuralFemale = spanishVoices.find(v => 
    (v.lang === 'es-AR' || v.lang === 'es_AR') && 
    /jimena|elena|luciana|mercedes|paulina|natural|neural|online|premium/i.test(v.name)
  );
  if (arNeuralFemale) return arNeuralFemale;

  // 2. Google Spanish Argentina Female or any es-AR Female
  const arGoogleOrFemale = spanishVoices.find(v => 
    (v.lang === 'es-AR' || v.lang === 'es_AR') && 
    !/male|hombre|tomas|jorge|pablo|raul|diego|alvaro/i.test(v.name)
  );
  if (arGoogleOrFemale) return arGoogleOrFemale;

  // 3. High-quality Latin American Neural Female voices (Dalia, Sabina, Paloma, Sofia, Mia, Monica)
  const latamNeuralFemale = spanishVoices.find(v => 
    /jimena|dalia|sabina|paloma|paulina|monica|luciana|elena|sofia|mia|natural|neural|online/i.test(v.name) &&
    !/male|hombre|raul|diego|alvaro|tomas|jorge/i.test(v.name)
  );
  if (latamNeuralFemale) return latamNeuralFemale;

  // 4. Any Latin American female/general voice (es-419, es-US, es-MX, es-CL, es-UY)
  const latamAny = spanishVoices.find(v => 
    ['es-AR', 'es-419', 'es-US', 'es-MX', 'es-CL', 'es-UY'].includes(v.lang) &&
    !/male|hombre/i.test(v.name)
  );
  if (latamAny) return latamAny;

  // 5. Fallback to any available Spanish voice
  return spanishVoices.find(v => !/male|hombre/i.test(v.name)) || spanishVoices[0] || null;
}

if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  window.speechSynthesis.onvoiceschanged = () => {
    cachedVoice = findSpanishVoice();
  };
}

export const NavigationVoice = {
  isMuted() {
    return localStorage.getItem('gd_nav_voice_muted') === 'true';
  },

  setMuted(muted) {
    localStorage.setItem('gd_nav_voice_muted', muted ? 'true' : 'false');
    if (muted && typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try { window.speechSynthesis.cancel(); } catch (e) {}
    }
    window.dispatchEvent(new CustomEvent('driver-voice-muted-changed', { detail: { isMuted: muted } }));
    return muted;
  },

  toggleMute() {
    return this.setMuted(!this.isMuted());
  },

  speak(text, priority = false) {
    if (this.isMuted()) return;
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    if (!text || typeof text !== 'string') return;

    const now = Date.now();
    // Prevent repeating the exact same phrase within 4 seconds unless high priority
    if (!priority && lastSpokenText === text && now - lastSpokenTimestamp < 4000) {
      return;
    }

    try {
      if (priority) {
        window.speechSynthesis.cancel();
      }

      const utterance = new SpeechSynthesisUtterance(text);
      if (!cachedVoice) cachedVoice = findSpanishVoice();
      if (cachedVoice) utterance.voice = cachedVoice;
      utterance.lang = cachedVoice ? cachedVoice.lang : 'es-AR';
      utterance.rate = 1.03;  // Natural, clear energetic conversational cadence
      utterance.pitch = 1.14; // Warm, friendly natural young female tone
      utterance.volume = 1.0;

      lastSpokenText = text;
      lastSpokenTimestamp = now;

      window.speechSynthesis.speak(utterance);
    } catch (err) {
      console.warn('[NavigationVoice] Speak failed:', err);
    }
  },

  /**
   * Intelligently processes telemetry from driver-navigation-map
   * Announces turns at distance thresholds without spamming the driver
   */
  processTelemetry(telemetry) {
    if (!telemetry || this.isMuted()) return;

    const { instruction, distanceMeters, totalDistanceMeters, targetStage, isRerouting } = telemetry;
    const now = Date.now();

    if (isRerouting) {
      const rerouteKey = 'reroute_' + Math.floor(now / 15000);
      if (lastSpokenStageKey !== rerouteKey) {
        lastSpokenStageKey = rerouteKey;
        this.speak('Recalculando ruta', true);
      }
      return;
    }

    if (!instruction) return;

    // Helper to argentinize turn phrases
    const formatArInstruction = (raw) => {
      let text = raw.toLowerCase();
      if (text.includes('izquierda')) return 'doblá a la izquierda';
      if (text.includes('derecha')) return 'doblá a la derecha';
      if (text.includes('rotonda')) return 'ingresá a la rotonda';
      if (text.includes('continúa') || text.includes('recto') || text.includes('derecho')) return 'continuá derecho';
      return raw;
    };

    // Arrival announcement (< 45m from destination)
    if (totalDistanceMeters !== undefined && totalDistanceMeters <= 45 && totalDistanceMeters > 0) {
      const arriveKey = `arrive_${targetStage}`;
      if (lastSpokenStageKey !== arriveKey) {
        lastSpokenStageKey = arriveKey;
        const msg = targetStage === 'pickup' 
          ? 'Llegaste al punto de retiro' 
          : 'Llegaste al domicilio de entrega';
        this.speak(msg, true);
      }
      return;
    }

    if (distanceMeters === undefined) return;

    // 1. Immediate turn announcement (<= 30m)
    if (distanceMeters <= 30 && distanceMeters > 5) {
      const turnKey = `turn_now_${instruction}`;
      if (lastSpokenStageKey !== turnKey) {
        lastSpokenStageKey = turnKey;
        const arInst = formatArInstruction(instruction);
        this.speak(`${arInst.charAt(0).toUpperCase() + arInst.slice(1)} ahora`, false);
      }
      return;
    }

    // 2. Upcoming turn announcement (75m - 140m)
    if (distanceMeters <= 140 && distanceMeters >= 75) {
      const advanceKey = `turn_adv_${instruction}`;
      if (lastSpokenStageKey !== advanceKey) {
        lastSpokenStageKey = advanceKey;
        const distRounded = Math.round(distanceMeters / 10) * 10;
        const arInst = formatArInstruction(instruction);
        this.speak(`En ${distRounded} metros, ${arInst}`, false);
      }
      return;
    }

    // 3. Far initial announcement (> 280m and first time entering segment)
    if (distanceMeters >= 280 && distanceMeters <= 500) {
      const farKey = `turn_far_${instruction}`;
      if (lastSpokenStageKey !== farKey && now - lastSpokenTimestamp > 18000) {
        lastSpokenStageKey = farKey;
        const distKm = (distanceMeters / 1000).toFixed(1);
        this.speak(`Continuá derecho por ${distKm} kilómetros`, false);
      }
    }
  },

  reset() {
    lastSpokenText = '';
    lastSpokenTimestamp = 0;
    lastSpokenStageKey = '';
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try { window.speechSynthesis.cancel(); } catch (e) {}
    }
  }
};
