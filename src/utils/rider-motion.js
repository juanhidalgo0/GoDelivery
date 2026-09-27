// Movimiento de la moto en el mapa del cliente, fluido como en Uber.
//
// El repartidor manda su posición cada ~3,5 s. Si la moto salta (o se mueve 1 s y queda quieta
// hasta el próximo dato) se ve a tirones. Acá:
// - la moto se mueve SIN PARAR durante todo el intervalo entre posiciones (medido en vivo);
// - si hay ruta, avanza por las calles de la ruta (no corta esquinas en línea recta);
// - gira suave hacia donde va y no tiembla cuando el GPS oscila parado;
// - la línea de la ruta muestra solo lo que falta (se "consume" detrás de la moto);
// - un salto grande (GPS que vuelve después de un rato) la ubica directo, sin cruzar el mapa.
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
const MIN_MS = 900, MAX_MS = 6000, DEFAULT_MS = 3500;

/**
 * Camino a recorrer entre lo que se ve y la nueva posición: por la ruta si los dos están sobre ella,
 * en orden de avance y sin rodeos raros; si no, en línea recta.
 */
export function motionPath(from, to, routePts) {
  if (routePts && routePts.length >= 2) {
    const a = projectOnRoute(from, routePts), b = projectOnRoute(to, routePts);
    if (a && b && a.dist <= SNAP_M && b.dist <= SNAP_M && b.along >= a.along - 3) {
      const path = routeSlice(routePts, a, b);
      const straight = meters(from, to);
      if (pathLength(path) <= straight * 3 + 30) return { path, onRoute: true };
    }
  }
  return { path: [from, to], onRoute: false };
}

/**
 * Motor de movimiento. hooks: setPosition({lat,lng}), setHeading(deg), setRemainingRoute(coords[[lng,lat]] | null)
 */
export function createRiderMotion(hooks, now = () => performance.now()) {
  let shown = null;        // lo que se ve ahora
  let heading = null;      // rumbo que se muestra (suavizado)
  let target = null;
  let anim = null;         // { path, length, start, dur }
  let raf = null;
  let lastPushAt = 0;
  let interval = DEFAULT_MS;
  let routePts = null;
  let lastRouteDraw = 0;
  let stopped = false;

  const turnTowards = (want, k) => {
    if (want == null) return;
    if (heading == null) { heading = want; return; }
    let d = ((want - heading + 540) % 360) - 180;
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

  const frame = () => {
    raf = null;
    if (stopped || !anim) return;
    const t = now();
    const k = Math.min(1, (t - anim.start) / anim.dur);
    const at = pointAlong(anim.path, anim.length * k); // velocidad constante, como un vehículo
    shown = at.point;
    turnTowards(at.heading, 0.18);
    hooks.setPosition(shown);
    if (heading != null) hooks.setHeading(heading);
    drawRoute(false);
    if (k < 1) raf = requestAnimationFrame(frame);
    else { anim = null; drawRoute(true); }
  };

  return {
    /** Nueva posición del repartidor. */
    push(pos) {
      if (!pos || !isFinite(pos.lat) || !isFinite(pos.lng)) return;
      const t = now();
      if (lastPushAt) interval = Math.max(MIN_MS, Math.min(MAX_MS, interval * 0.6 + (t - lastPushAt) * 0.4));
      lastPushAt = t;
      target = { lat: pos.lat, lng: pos.lng };
      if (!shown || meters(shown, target) > JUMP_M) {
        // Primera vez o salto grande: directo
        shown = target;
        anim = null;
        hooks.setPosition(shown);
        drawRoute(true);
        return;
      }
      const moved = meters(shown, target);
      if (moved < 1.5) return; // oscilación del GPS parado: no se mueve ni gira
      const { path } = motionPath(shown, target, routePts);
      // Dura un poco más que el intervalo: llega justo cuando viene el dato siguiente (nunca frena)
      anim = { path, length: pathLength(path), start: t, dur: interval * 1.08 };
      if (!raf && !stopped) raf = requestAnimationFrame(frame);
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
    stop() { stopped = true; if (raf) cancelAnimationFrame(raf); raf = null; },
  };
}
