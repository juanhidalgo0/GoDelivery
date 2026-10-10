// Filtro del GPS del repartidor: lo que sale de acá es lo que ven el cliente, el admin y su mapa.
//
// El GPS del celular a veces da puntos malos: al arrancar, bajo techo o entre edificios da una
// posición por antenas/wifi a 50–300 m, o salta una cuadra y vuelve. Mandarlos tal cual hacía
// saltar a la moto en el mapa del cliente. Acá:
// - se descartan los puntos imprecisos mientras haya uno bueno reciente;
// - se descartan los saltos imposibles (más rápido que una moto), salvo que se repitan: entonces
//   el equivocado era el anterior;
// - parado, la posición queda clavada (el GPS "baila" unos metros y la moto temblaba);
// - se descartan los puntos viejos o repetidos (llegan desordenados al volver la señal).
// Pura (sin Firebase ni mapa) para poder probarla sola.

import { meters, bearing } from './rider-motion.js';

export const GOOD_ACCURACY_M = 35;     // hasta acá el punto se usa siempre
const COARSE_ACCURACY_M = 120;         // hasta acá, solo si hace rato que no hay uno bueno
const COARSE_AFTER_MS = 25000;
const MAX_SPEED_MS = 33;               // ~120 km/h: más que esto es un salto del GPS
const MAX_REJECTED_JUMPS = 3;
const MOVING_SPEED_MS = 0.8;           // ~3 km/h: con menos, parado
const STILL_RADIUS_M = 8;              // parado: los puntos a menos que esto (o que su precisión) no mueven

/**
 * Normaliza lo que dan navigator.geolocation, @capacitor/geolocation y el watcher nativo
 * (@capacitor-community/background-geolocation) a { lat, lng, accuracy, time, speed, heading }.
 */
export function normalizeFix(raw) {
  if (!raw) return null;
  const c = raw.coords || raw;
  const lat = Number(c.latitude ?? c.lat);
  const lng = Number(c.longitude ?? c.lng);
  const num = (v) => (v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
  return {
    lat,
    lng,
    accuracy: num(c.accuracy),
    time: num(raw.timestamp ?? raw.time ?? c.time),
    speed: num(c.speed),
    heading: num(c.heading ?? c.bearing),
  };
}

export function createGpsFilter(now = () => Date.now()) {
  let last = null;        // último punto aceptado (crudo)
  let anchor = null;      // parado: la posición que se muestra
  let out = null;         // último punto entregado
  let lastGoodAt = now(); // cuándo hubo uno bueno (al crearse cuenta como bueno: da tiempo a que enganche)
  let jump = null;        // último punto descartado por salto, y cuántos seguidos coinciden con él
  let jumpRun = 0;

  function push(raw) {
    const f = normalizeFix(raw);
    if (!f || !Number.isFinite(f.lat) || !Number.isFinite(f.lng)) return { fix: null, reason: 'invalid' };
    if (Math.abs(f.lat) > 90 || Math.abs(f.lng) > 180 || (f.lat === 0 && f.lng === 0)) return { fix: null, reason: 'invalid' };
    const time = f.time || now();

    if (last && time <= last.time) {
      // El reloj del celular se corrigió para atrás: sin esto no se aceptaría nada más
      if (last.time - time > 5 * 60 * 1000) { last = null; jump = null; jumpRun = 0; }
      else return { fix: null, reason: 'old' };
    }

    // Precisión desconocida (algunos Android): se toma como aceptable
    const acc = f.accuracy != null && f.accuracy > 0 ? f.accuracy : GOOD_ACCURACY_M;
    if (acc > GOOD_ACCURACY_M) {
      const withoutGood = time - lastGoodAt;
      if (acc > COARSE_ACCURACY_M || withoutGood < COARSE_AFTER_MS) return { fix: null, reason: 'imprecise' };
    }

    if (last && impliedSpeed(last, { ...f, acc, time }) > MAX_SPEED_MS) {
      // Si los puntos "imposibles" coinciden entre sí, el equivocado era el último aceptado
      const cand = { lat: f.lat, lng: f.lng, acc, time };
      if (jump && impliedSpeed(jump, cand) <= MAX_SPEED_MS) jumpRun++;
      else jumpRun = 1;
      jump = cand;
      if (jumpRun < MAX_REJECTED_JUMPS) return { fix: null, reason: 'jump' };
    }
    jump = null;
    jumpRun = 0;

    last = { lat: f.lat, lng: f.lng, acc, time };
    if (acc <= GOOD_ACCURACY_M) lastGoodAt = time;

    // ¿Se está moviendo? La velocidad del GPS (por efecto Doppler) es mucho más fiable que la
    // diferencia entre dos posiciones; si no la hay, se mira si se alejó de donde estaba parado.
    const knownSpeed = f.speed != null && f.speed >= 0 ? f.speed : null;
    // Dos lecturas de ±acc pueden estar a 2×acc entre sí sin que se haya movido
    const stillRadius = Math.max(STILL_RADIUS_M, Math.min(acc * 2, 40));
    let pos;
    if (knownSpeed != null && knownSpeed >= MOVING_SPEED_MS) {
      anchor = null;
      pos = { lat: f.lat, lng: f.lng };
    } else if (anchor && meters(anchor, f) <= stillRadius) {
      pos = anchor;
    } else {
      anchor = { lat: f.lat, lng: f.lng };
      pos = anchor;
    }
    const moving = !anchor || (out != null && meters(out, pos) > 0);

    // Rumbo: el del GPS cuando va andando; si no, hacia dónde se movió
    let heading = out ? out.heading : null;
    if (f.heading != null && f.heading >= 0 && knownSpeed != null && knownSpeed >= 1) heading = f.heading % 360;
    else if (out && meters(out, pos) >= 3) heading = bearing(out, pos);

    const speed = knownSpeed != null ? knownSpeed
      : (out ? meters(out, pos) / Math.max(1, (time - out.time) / 1000) : 0);
    out = {
      lat: pos.lat,
      lng: pos.lng,
      accuracy: Math.round(acc * 10) / 10,
      time,
      speed,
      heading,
      moving,
    };
    return { fix: out, reason: 'ok' };
  }

  return {
    push,
    last: () => out,
    reset() { last = null; anchor = null; out = null; jump = null; jumpRun = 0; lastGoodAt = now(); },
  };
}

// Velocidad mínima para ir de a a b ({lat,lng,acc,time}), descontando el margen de error de los
// dos puntos: dos lecturas de ±10 m pueden estar a 10 m sin que el repartidor se haya movido.
function impliedSpeed(a, b) {
  const dt = Math.max(1, (b.time - a.time) / 1000);
  return Math.max(0, meters(a, b) - (a.acc + b.acc) / 2) / dt;
}
