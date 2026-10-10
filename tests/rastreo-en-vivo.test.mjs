// Rastreo en vivo: filtro del GPS del repartidor (src/utils/gps-filter.js) y movimiento de la moto
// en el mapa del cliente (src/utils/rider-motion.js). No necesita emuladores:
//
//   node tests/rastreo-en-vivo.test.mjs
//
// Simula un repartidor de verdad (GPS con ruido, puntos malos, red que demora cada dato distinto,
// paradas) y mide lo que ve el cliente cuadro por cuadro: que la moto no salte, no vaya para atrás,
// no se frene mientras el repartidor anda y no se salga de la ruta.

import { createGpsFilter, normalizeFix } from '../src/utils/gps-filter.js';
import { createRiderMotion, meters, projectOnRoute, toPoints } from '../src/utils/rider-motion.js';

let pass = 0, fail = 0;
const failures = [];
function check(label, ok, detail = '') {
  if (ok) { pass++; console.log('  OK   ' + label + (detail ? `  (${detail})` : '')); }
  else { fail++; failures.push(label); console.log('  FALLO ' + label + (detail ? '  → ' + detail : '')); }
}

// Números al azar pero siempre los mismos (la prueba da igual cada vez)
function rng(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const ORIGIN = { lat: -35.0800, lng: -57.5150 }; // Magdalena
const M_LAT = 1 / 111320;
const M_LNG = 1 / (111320 * Math.cos(ORIGIN.lat * Math.PI / 180));
const at = (east, north) => ({ lat: ORIGIN.lat + north * M_LAT, lng: ORIGIN.lng + east * M_LNG });

/** Punto a d metros sobre un camino [{lat,lng}] */
function along(path, d) {
  let acc = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const L = meters(path[i], path[i + 1]);
    if (acc + L >= d) {
      const k = (d - acc) / L;
      return { lat: path[i].lat + (path[i + 1].lat - path[i].lat) * k, lng: path[i].lng + (path[i + 1].lng - path[i].lng) * k };
    }
    acc += L;
  }
  return path[path.length - 1];
}

/**
 * Corre el motor con relojes falsos: `deliveries` = [{ at (ms del cliente), pos: {lat,lng,t} }].
 * Devuelve la posición que se vio en cada cuadro (60 por segundo).
 */
function runMotion(deliveries, { endAt, route = null, clockSkew = 0 } = {}) {
  let perf = 0;
  let frames = [];
  globalThis.requestAnimationFrame = (cb) => { frames.push(cb); return frames.length; };
  globalThis.cancelAnimationFrame = () => { frames = []; };
  let lastShown = null;
  const motion = createRiderMotion({
    setPosition: (p) => { lastShown = { ...p }; },
    setHeading: () => {},
    setRemainingRoute: () => {},
  }, () => perf, () => perf + clockSkew);
  if (route) motion.setRoute(route.map(p => [p.lng, p.lat]));
  const queue = [...deliveries].sort((a, b) => a.at - b.at);
  const seen = [];
  for (perf = 0; perf <= endAt; perf += 16) {
    while (queue.length && queue[0].at <= perf) motion.push(queue.shift().pos);
    const run = frames; frames = [];
    run.forEach(cb => cb(perf));
    if (lastShown) seen.push({ at: perf, ...lastShown });
  }
  return { seen, motion };
}

/** Velocidad máxima vista, cuadros en que la moto quedó quieta y si alguna vez fue para atrás. */
function measure(seen, path, { from = 0, to = Infinity, movingUntil = Infinity } = {}) {
  let maxSpeed = 0, stalls = 0, frames = 0, maxBack = 0, maxOff = 0;
  let prev = null, prevAlong = -Infinity;
  const pts = path;
  for (const s of seen) {
    if (s.at < from || s.at > to) { prev = s; continue; }
    const proj = projectOnRoute(s, pts);
    maxOff = Math.max(maxOff, proj.dist);
    if (prev) {
      const step = meters(prev, s);
      maxSpeed = Math.max(maxSpeed, step / ((s.at - prev.at) / 1000));
      if (s.at < movingUntil) { frames++; if (step < 1e-4) stalls++; }
      if (proj.along < prevAlong) maxBack = Math.max(maxBack, prevAlong - proj.along);
    }
    prevAlong = Math.max(prevAlong, proj.along);
    prev = s;
  }
  return { maxSpeed, stallPct: frames ? (100 * stalls / frames) : 0, maxBack, maxOff };
}

// ───────────────────────────────────────────────────────────── filtro del GPS
console.log('\n=========== FILTRO DEL GPS DEL REPARTIDOR ===========');
{
  const T0 = 1_790_000_000_000;
  let clock = T0;
  const f = createGpsFilter(() => clock);
  const fix = (east, north, extra = {}) => ({ latitude: at(east, north).lat, longitude: at(east, north).lng, accuracy: 6, speed: 8, bearing: 90, time: clock, ...extra });

  check('acepta un punto bueno', f.push(fix(0, 0)).fix !== null);
  clock += 1000;
  check('descarta un punto impreciso (80 m) si hay uno bueno reciente', f.push(fix(8, 0, { accuracy: 80 })).reason === 'imprecise');
  clock += 1000;
  check('descarta un punto de antenas (300 m) siempre', f.push(fix(16, 0, { accuracy: 300 })).reason === 'imprecise');
  clock += 1000;
  check('descarta un salto imposible (200 m en 1 s)', f.push(fix(24, 200)).reason === 'jump');
  clock += 1000;
  const r = f.push(fix(32, 0));
  check('después del salto sigue aceptando los puntos buenos', r.fix !== null && meters(r.fix, at(32, 0)) < 0.01);
  check('descarta un punto repetido o viejo', f.push(fix(40, 0, { time: clock - 500 })).reason === 'old');

  // El último aceptado era el equivocado: tres puntos seguidos que coinciden entre sí lo corrigen
  clock += 1000; f.push(fix(500, 500));
  clock += 1000; f.push(fix(508, 500));
  clock += 1000;
  const fixed = f.push(fix(516, 500));
  check('si los "saltos" coinciden entre sí, el repartidor está ahí (tercer punto)', fixed.fix !== null && meters(fixed.fix, at(516, 500)) < 0.01);

  // Sin un punto bueno por un rato, uno regular sirve (mejor que congelado)
  clock += 26000;
  check('pasados 25 s sin uno bueno, acepta uno regular (80 m)', f.push(fix(520, 500, { accuracy: 80 })).fix !== null);
}
{
  let clock = 1_790_000_000_000;
  const f = createGpsFilter(() => clock);
  const rand = rng(7);
  const outs = [];
  for (let i = 0; i < 60; i++) {
    clock += 1000;
    const p = at((rand() - 0.5) * 10, (rand() - 0.5) * 10); // ±5 m de "baile" del GPS parado
    const r = f.push({ coords: { latitude: p.lat, longitude: p.lng, accuracy: 8, speed: 0.2 }, timestamp: clock });
    if (r.fix) outs.push(r.fix);
  }
  const spread = Math.max(...outs.map(o => meters(o, outs[0])));
  check('parado con el GPS bailando ±5 m, la posición queda clavada', spread < 0.01, `se movió ${spread.toFixed(2)} m`);
  check('parado no se marca como en movimiento', outs.slice(1).every(o => !o.moving));
}
{
  const n = normalizeFix({ latitude: -35, longitude: -57, accuracy: 5, speed: 3, bearing: 45, time: 123 });
  check('lee el formato del watcher nativo (bearing, time)', n.heading === 45 && n.time === 123 && n.accuracy === 5);
  const w = normalizeFix({ coords: { latitude: -35, longitude: -57, accuracy: 9, speed: null, heading: null }, timestamp: 456 });
  check('lee el formato del navegador (coords, timestamp; velocidad desconocida)', w.time === 456 && w.speed === null && w.accuracy === 9);
}

// ───────────────────────────────────────────────────────────── la moto en el mapa
console.log('\n=========== LA MOTO EN EL MAPA DEL CLIENTE ===========');
const SKEW = 5_000_000; // el reloj del celular del repartidor no coincide con el del cliente

// 1) Recta, 8 m/s (~30 km/h), un dato cada 2 s con demoras de red de 100 a 900 ms y alguna de 2,5 s
{
  const rand = rng(42);
  const path = [at(0, 0), at(1500, 0)];
  const SPEED = 8;
  const deliveries = [];
  for (let k = 0; k * 2000 * SPEED / 1000 <= 1500; k++) {
    const readAt = 1000 + k * 2000 + (rand() - 0.5) * 200;
    const p = along(path, Math.min(1500, (readAt - 1000) / 1000 * SPEED));
    const delay = rand() < 0.05 ? 2500 : 100 + rand() * 800;
    deliveries.push({ at: readAt + delay, pos: { ...p, t: readAt + SKEW } });
  }
  const end = deliveries[deliveries.length - 1].at + 8000;
  const { seen } = runMotion(deliveries, { endAt: end });
  const m = measure(seen, path, { from: 8000, movingUntil: 1000 + 1500 / SPEED * 1000 - 1000 });
  check('recta: nunca salta (velocidad máxima ≤ 1,5 × la real)', m.maxSpeed <= SPEED * 1.5, `máx ${m.maxSpeed.toFixed(1)} m/s, real ${SPEED}`);
  check('recta: no se frena mientras el repartidor anda (< 3 % de cuadros quieta)', m.stallPct < 3, `${m.stallPct.toFixed(1)} % quieta`);
  check('recta: nunca va para atrás', m.maxBack < 0.01, `${m.maxBack.toFixed(2)} m`);
  const last = seen[seen.length - 1];
  const lastSent = deliveries[deliveries.length - 1].pos;
  check('recta: termina exactamente en el último dato del repartidor', meters(last, lastSent) < 0.5, `${meters(last, lastSent).toFixed(2)} m`);
  // Atraso respecto del repartidor real (en el medio del viaje)
  const mid = seen.find(s => s.at >= 90000);
  const lagM = (90000 - 1000) / 1000 * SPEED - projectOnRoute(mid, path).along;
  check('recta: va a menos de 4 s detrás del repartidor', lagM / SPEED < 4, `${(lagM / SPEED).toFixed(1)} s, ${lagM.toFixed(0)} m`);
}

// 2) Esquina con ruta y GPS con ±4 m de error: la moto va por la calle y dobla en la esquina
{
  const rand = rng(3);
  const route = [at(0, 0), at(300, 0), at(300, 300)];
  const SPEED = 7;
  const deliveries = [];
  for (let k = 0; k * 2 * SPEED <= 600; k++) {
    const readAt = 1000 + k * 2000;
    const p = along(route, Math.min(600, k * 2 * SPEED));
    const noisy = { lat: p.lat + (rand() - 0.5) * 8 * M_LAT, lng: p.lng + (rand() - 0.5) * 8 * M_LNG };
    deliveries.push({ at: readAt + 150 + rand() * 600, pos: { ...noisy, t: readAt + SKEW } });
  }
  const { seen } = runMotion(deliveries, { endAt: deliveries[deliveries.length - 1].at + 8000, route });
  const m = measure(seen, route, { from: 6000 });
  check('esquina: la moto va siempre sobre la calle (GPS con ±4 m)', m.maxOff < 0.5, `se apartó ${m.maxOff.toFixed(2)} m`);
  check('esquina: no corta la esquina ni retrocede', m.maxBack < 0.01, `${m.maxBack.toFixed(2)} m`);
  check('esquina: sin saltos', m.maxSpeed <= SPEED * 1.6, `máx ${m.maxSpeed.toFixed(1)} m/s`);
}

// 3) Anda, se para 40 s en el comercio (latidos cada 15 s en el mismo lugar) y vuelve a arrancar
{
  const path = [at(0, 0), at(600, 0)];
  const SPEED = 8;
  const deliveries = [];
  const positionAt = (s) => (s < 25 ? s * SPEED : s < 65 ? 25 * SPEED : Math.min(600, 25 * SPEED + (s - 65) * SPEED));
  for (let s = 0; s <= 120; s += 2) {
    if (s > 26 && s < 65 && (s - 25) % 15 !== 0) continue; // parado: solo latidos (el de s=26 es el que avisa que llegó)
    deliveries.push({ at: 1000 + s * 1000 + 300, pos: { ...along(path, positionAt(s)), t: 1000 + s * 1000 + SKEW } });
  }
  const { seen } = runMotion(deliveries, { endAt: 130000 });
  const m = measure(seen, path, { from: 6000 });
  check('parada: al volver a arrancar no salta', m.maxSpeed <= SPEED * 1.5, `máx ${m.maxSpeed.toFixed(1)} m/s`);
  check('parada: nunca va para atrás', m.maxBack < 0.01);
  const stopped = seen.filter(s => s.at > 35000 && s.at < 64000);
  const drift = Math.max(...stopped.map(s => meters(s, stopped[0])));
  check('parada: quieta mientras el repartidor espera', drift < 0.01, `${drift.toFixed(2)} m`);
}

// 4) Datos repetidos, desordenados y un salto enorme
{
  const p0 = at(0, 0), p1 = at(16, 0), p2 = at(32, 0);
  const far = at(3000, 0);
  const deliveries = [
    { at: 100, pos: { ...p0, t: 0 } },
    { at: 2100, pos: { ...p1, t: 2000 } },
    { at: 2200, pos: { ...p1, t: 2000 } },   // el mismo dato otra vez (el pedido cambió de estado)
    { at: 2300, pos: { ...p0, t: 0 } },      // uno viejo que llegó tarde
    { at: 4100, pos: { ...p2, t: 4000 } },
    { at: 20000, pos: { ...far, t: 19900 } }, // GPS que vuelve 3 km más allá
  ];
  const { seen, motion } = runMotion(deliveries, { endAt: 19984 });
  const m = measure(seen, [p0, p2], { from: 0 });
  check('repetidos y viejos: no la hacen retroceder', m.maxBack < 0.01);
  check('repetidos y viejos: no se encolan', motion.stats().queued <= 3, `${motion.stats().queued} en cola`);
  const { seen: seen2 } = runMotion(deliveries, { endAt: 20016 });
  check('salto de 3 km: la ubica directo (no cruza el mapa)', meters(seen2[seen2.length - 1], far) < 0.01);
}

// 5) Todo junto: GPS crudo 1 por segundo con puntos malos → filtro → envío cada 2 s → red → moto
{
  const rand = rng(11);
  const route = [at(0, 0), at(400, 0), at(400, 400), at(800, 400)];
  const SPEED = 9;
  const filter = createGpsFilter(() => 0);
  const deliveries = [];
  let lastSent = -Infinity, lastSentPos = null, bad = 0;
  for (let s = 0; s * SPEED <= 1200; s++) {
    const readAt = 1000 + s * 1000;
    const truth = along(route, s * SPEED);
    let p = { lat: truth.lat + (rand() - 0.5) * 6 * M_LAT, lng: truth.lng + (rand() - 0.5) * 6 * M_LNG };
    let accuracy = 5 + rand() * 5;
    if (s % 17 === 5) { p = at(250 * (rand() - 0.5) + 400, 250 * (rand() - 0.5)); bad++; }  // rebote entre edificios
    if (s % 23 === 9) { accuracy = 90; bad++; }                                              // por antenas
    const { fix } = filter.push({ coords: { latitude: p.lat, longitude: p.lng, accuracy, speed: SPEED, heading: 0 }, timestamp: readAt + SKEW });
    if (!fix) continue;
    const moved = lastSentPos ? meters(lastSentPos, fix) : Infinity;
    if (readAt - lastSent >= 2000 && moved >= 2) {
      lastSent = readAt; lastSentPos = fix;
      deliveries.push({ at: readAt + 120 + rand() * 700, pos: { lat: fix.lat, lng: fix.lng, t: fix.time } });
    }
  }
  const { seen } = runMotion(deliveries, { endAt: deliveries[deliveries.length - 1].at + 8000, route });
  const m = measure(seen, route, { from: 6000 });
  check(`completo: ${bad} puntos malos del GPS y la moto no salta`, m.maxSpeed <= SPEED * 1.6, `máx ${m.maxSpeed.toFixed(1)} m/s, real ${SPEED}`);
  check('completo: siempre sobre la calle', m.maxOff < 0.5, `${m.maxOff.toFixed(2)} m`);
  check('completo: nunca para atrás', m.maxBack < 0.01, `${m.maxBack.toFixed(2)} m`);
}

console.log(`\n${pass} OK, ${fail} fallos`);
if (fail) {
  console.log('Fallaron:\n - ' + failures.join('\n - '));
  process.exit(1);
}
