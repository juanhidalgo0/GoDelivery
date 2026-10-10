// Movimiento de la moto en el mapa del cliente, fluido como en Uber.
//
// El repartidor manda su posición cada ~2 s, con la hora exacta de la lectura del GPS. La moto no
// persigue el último dato (así se movía a tirones: frenaba cuando un dato llegaba tarde y aceleraba
// cuando llegaban dos juntos). Reproduce el recorrido del repartidor con un atraso fijo de ~2-3 s,
// como un video con buffer: siempre tiene el tramo siguiente, va a la velocidad real y dobla donde
// dobló él. Además:
// - si hay ruta, cada tramo va por las calles de la ruta (no corta esquinas en línea recta);
// - un retroceso corto sobre la ruta es ruido del GPS: la moto no va para atrás;
// - parada, no se mueve ni gira;
// - un salto grande (GPS que vuelve después de un rato) la ubica directo, sin cruzar el mapa;
// - la línea de la ruta muestra solo lo que falta (se "consume" detrás de la moto).
// La geometría es pura (sin mapa) para poder probarla sola.

const R = 6371000;
const toRad = (x) => x * Math.PI / 180;

export function meters(a, b) {
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function bearing(a, b) {
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) - Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

const lerp = (a, b, t) => ({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t });

/** [[lng,lat],...] → [{lat,lng},...] */
export function toPoints(coords = []) {
  return coords.filter(c => Array.isArray(c) && isFinite(c[0]) && isFinite(c[1])).map(c => ({ lng: Number(c[0]), lat: Number(c[1]) }));
}

/**
 * El punto de la ruta más cercano a p: { point, seg, t, along (m desde el inicio), dist (m) }.
 * Aproximación plana por tramo (tramos cortos de calle: error despreciable).
 */
export function projectOnRoute(p, pts) {
  let best = null;
  let along = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const kx = Math.cos(toRad(a.lat));
    const ax = a.lng * kx, ay = a.lat, bx = b.lng * kx, by = b.lat, px = p.lng * kx, py = p.lat;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    const q = lerp(a, b, t);
    const d = meters(p, q);
    const segLen = meters(a, b);
    if (!best || d < best.dist) best = { point: q, seg: i, t, along: along + segLen * t, dist: d };
    along += segLen;
  }
  return best;
}

/** Tramo de la ruta entre dos proyecciones (incluye los extremos). */
export function routeSlice(pts, from, to) {
  const out = [from.point];
  for (let i = from.seg + 1; i <= to.seg; i++) out.push(pts[i]);
  out.push(to.point);
  return out;
}

/** Lo que falta de la ruta desde una proyección hasta el final. */
export function routeRemaining(pts, from) {
  return [from.point, ...pts.slice(from.seg + 1)];
}

export function pathLength(path) {
  let L = 0;
  for (let i = 0; i < path.length - 1; i++) L += meters(path[i], path[i + 1]);
  return L;
}

/** Punto y rumbo a d metros del inicio del camino. */
export function pointAlong(path, d) {
  if (path.length === 1) return { point: path[0], heading: null };
  let acc = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const seg = meters(path[i], path[i + 1]);
    if (acc + seg >= d || i === path.length - 2) {
      const t = seg > 0 ? Math.max(0, Math.min(1, (d - acc) / seg)) : 1;
      return { point: lerp(path[i], path[i + 1], t), heading: seg > 0.5 ? bearing(path[i], path[i + 1]) : null };
    }
    acc += seg;
  }
  return { point: path[path.length - 1], heading: null };
}

const SNAP_M = 40;          // a esta distancia de la ruta se considera "sobre la ruta"
const JUMP_M = 500;         // más que esto de un dato al otro: se ubica directo
const STILL_M = 2;          // menos que esto entre dos datos: GPS oscilando parado, no se mueve
const BACKTRACK_M = 20;     // retroceder menos que esto sobre la ruta: ruido, se queda donde está
const DEFAULT_GAP_MS = 2500;
const BUFFER_MIN_MS = 1200, BUFFER_MAX_MS = 6000;
const LONG_GAP_MS = 6000;   // más que esto entre dos datos: estuvo parado o sin señal
const MAX_LAG_MS = 12000;   // más atrasada que esto (pestaña dormida): se pone al día de una

/**
 * Camino de un dato al siguiente: por la ruta si los dos están sobre ella, en orden de avance y
 * sin rodeos raros; si no, en línea recta. `still`: no se mueve (ruido del GPS o retroceso corto).
 * El camino arranca exactamente en `from`, así la moto nunca salta entre un tramo y el siguiente.
 */
export function segmentPath(from, to, routePts) {
  const straight = meters(from, to);
  if (straight < STILL_M) return { path: [from], length: 0, still: true };
  if (routePts && routePts.length >= 2) {
    const a = projectOnRoute(from, routePts), b = projectOnRoute(to, routePts);
    if (a && b && a.dist <= SNAP_M && b.dist <= SNAP_M) {
      if (b.along < a.along) {
        if (a.along - b.along < BACKTRACK_M) return { path: [from], length: 0, still: true };
      } else {
        const slice = routeSlice(routePts, a, b);
        const path = [from, ...(meters(from, slice[0]) > 0.5 ? slice : slice.slice(1))];
        const length = pathLength(path);
        if (length <= straight * 3 + 30) return { path, length, onRoute: true };
      }
    }
  }
  return { path: [from, to], length: straight };
}

const quantile = (arr, q) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.round(q * (s.length - 1)))];
};

/**
 * Motor de movimiento. hooks: setPosition({lat,lng}), setHeading(deg), setRemainingRoute(coords[[lng,lat]] | null)
 * push({ lat, lng, t }): t = hora de la lectura del GPS (ms, reloj del repartidor). Sin t (datos
 * viejos, sin esa hora) se toma la hora de llegada.
 */
export function createRiderMotion(hooks, now = () => performance.now(), wallNow = () => Date.now()) {
  let samples = [];        // [{ q, t, path, length, still }]: q = dónde queda la moto, path = cómo llega desde el anterior
  let delays = [];         // llegada - t de los últimos datos (demora de red + diferencia de relojes)
  let gaps = [];           // tiempo entre lecturas mientras anda
  let renderT = null;      // en qué momento del recorrido está la moto que se ve
  let lastFrameAt = 0;
  let shown = null;
  let heading = null;
  let raf = null;
  let routePts = null;
  let lastRouteDraw = 0;
  let stopped = false;

  const remember = (arr, v, n) => { arr.push(v); if (arr.length > n) arr.shift(); };
  const typicalGap = () => (gaps.length ? quantile(gaps, 0.5) : DEFAULT_GAP_MS);
  // El dato que llegó más rápido marca la demora "sin red"; los demás llegan con algo de más
  const baseDelay = () => Math.min(...delays);
  // Colchón: un intervalo entre datos + lo que suelen atrasarse. Así casi nunca se queda sin tramo.
  const buffer = () => {
    const jitter = delays.length ? quantile(delays, 0.8) - baseDelay() : 0;
    return Math.max(BUFFER_MIN_MS, Math.min(BUFFER_MAX_MS, typicalGap() + jitter + 300));
  };

  const turnTowards = (want, k) => {
    if (want == null) return;
    if (heading == null) { heading = want; return; }
    const d = ((want - heading + 540) % 360) - 180;
    heading = (heading + d * k + 360) % 360;
  };

  const drawRoute = (force) => {
    if (!routePts || !shown) return;
    const t = now();
    if (!force && t - lastRouteDraw < 90) return;
    lastRouteDraw = t;
    const p = projectOnRoute(shown, routePts);
    if (p && p.dist <= SNAP_M * 2) hooks.setRemainingRoute(routeRemaining(routePts, p).map(q => [q.lng, q.lat]));
    else hooks.setRemainingRoute(routePts.map(q => [q.lng, q.lat])); // fuera de la ruta: se recalcula aparte
  };

  // Tramo que se está recorriendo en el momento T (el dato al que se va llegando)
  const segmentIndexAt = (T) => {
    for (let i = 1; i < samples.length; i++) if (T <= samples[i].t) return i;
    return samples.length - 1;
  };

  const positionAt = (T) => {
    if (T <= samples[0].t || samples.length === 1) return { point: samples[0].q, heading: null };
    const i = segmentIndexAt(T);
    const s = samples[i], prev = samples[i - 1];
    if (T >= s.t) return { point: s.q, heading: null };
    if (!s.length) return { point: s.q, heading: null };
    const k = (T - prev.t) / (s.t - prev.t);
    return pointAlong(s.path, s.length * k); // velocidad constante en el tramo, como un vehículo
  };

  const schedule = () => {
    if (!raf && !stopped) { lastFrameAt = 0; raf = requestAnimationFrame(frame); }
  };

  function frame() {
    raf = null;
    if (stopped || !samples.length) return;
    const tl = now();
    const dt = lastFrameAt ? Math.min(tl - lastFrameAt, 1000) : 16;
    lastFrameAt = tl;
    const lastT = samples[samples.length - 1].t;
    const target = tl - baseDelay() - buffer();
    if (renderT == null) renderT = target;
    const behind = target - renderT;
    if (behind > MAX_LAG_MS) {
      renderT = target;
    } else {
      // Para mantener el colchón se apura o se frena de a poco (±30 %), nunca de golpe
      renderT += dt * Math.max(0.7, Math.min(1.4, 1 + behind / 3000));
      // Si va atrasada y está en un tramo parada, ese rato se saltea: no se nota
      if (behind > 400) {
        const s = samples[segmentIndexAt(renderT)];
        if (s.still) renderT = Math.max(renderT, Math.min(target, s.t));
      }
    }
    renderT = Math.max(samples[0].t, Math.min(renderT, lastT));

    // Lo ya recorrido no hace falta más (se deja el dato anterior al momento actual)
    while (samples.length > 2 && samples[1].t <= renderT) samples.shift();

    const at = positionAt(renderT);
    shown = at.point;
    turnTowards(at.heading, 0.18);
    hooks.setPosition(shown);
    if (heading != null) hooks.setHeading(heading);
    drawRoute(false);

    if (renderT < lastT) raf = requestAnimationFrame(frame);
    else drawRoute(true); // llegó al último dato: espera el siguiente
  }

  const restartAt = (p, t) => {
    samples = [{ q: p, t, path: [p], length: 0, still: true }];
    renderT = t;
    shown = p;
    hooks.setPosition(shown);
    drawRoute(true);
  };

  return {
    /** Nueva posición del repartidor. */
    push(pos) {
      if (!pos || !isFinite(pos.lat) || !isFinite(pos.lng)) return;
      const p = { lat: Number(pos.lat), lng: Number(pos.lng) };
      const t = Number.isFinite(pos.t) ? pos.t : wallNow();
      const last = samples[samples.length - 1];

      if (last && t <= last.t) {
        if (last.t - t < 5 * 60 * 1000) return; // repetido o desordenado
        // El reloj del repartidor se corrigió para atrás: se arranca de nuevo
        delays = []; gaps = [];
      }
      remember(delays, now() - t, 20);

      if (!last || t <= last.t || !shown || meters(last.q, p) > JUMP_M) {
        // Primera vez o salto grande: directo
        restartAt(p, t);
        return;
      }

      const gap = t - last.t;
      let from = last;
      if (gap > LONG_GAP_MS) {
        // Estuvo parado o sin señal: queda donde estaba hasta un momento antes del dato nuevo
        const hold = { q: last.q, t: t - Math.min(gap - 1, typicalGap()), path: [last.q], length: 0, still: true };
        samples.push(hold);
        from = hold;
      } else {
        remember(gaps, gap, 10);
      }
      const seg = segmentPath(from.q, p, routePts);
      samples.push({ q: seg.path[seg.path.length - 1], t, path: seg.path, length: seg.length, still: !!seg.still });
      schedule();
    },
    /** Ruta nueva por calles ([[lng,lat],...]) o null. */
    setRoute(coords) {
      const pts = coords ? toPoints(coords) : null;
      routePts = pts && pts.length >= 2 ? pts : null;
      if (!routePts) return;
      // Si la moto está sobre la ruta nueva, que mire hacia donde sigue
      if (shown) {
        const p = projectOnRoute(shown, routePts);
        if (p && p.dist <= SNAP_M && heading == null) {
          const next = routePts[Math.min(p.seg + 1, routePts.length - 1)];
          turnTowards(bearing(p.point, next), 1);
          if (heading != null) hooks.setHeading(heading);
        }
      }
      drawRoute(true);
    },
    current() { return shown; },
    /** Para depurar: cuánto atrás del dato más nuevo va la moto (ms) y el colchón actual. */
    stats() {
      const lastT = samples.length ? samples[samples.length - 1].t : null;
      return { behindLatestMs: lastT != null && renderT != null ? lastT - renderT : null, bufferMs: delays.length ? buffer() : null, queued: samples.length };
    },
    stop() { stopped = true; if (raf) cancelAnimationFrame(raf); raf = null; },
  };
}
