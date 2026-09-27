// Dónde se quedó quieto el repartidor.
//
// Para aprender la ubicación de un comercio no sirve la posición del momento en que desliza "ya compré":
// puede deslizar tarde (ya en camino) o antes de llegar. Comprar lleva minutos, así que el comercio es
// donde estuvo parado un rato. Acá se guardan las posiciones de los últimos minutos y se buscan esas paradas.

const KEEP_MS = 60 * 60 * 1000;   // posiciones de la última hora
const MAX_POINTS = 1500;
const MAX_GAP_MS = 3 * 60 * 1000; // sin GPS más que esto, no se cuenta como tiempo parado

let points = []; // [{ lat, lng, at, acc }]

/** Se llama con cada posición del GPS. */
export function recordDriverPosition(lat, lng, accuracy = null, at = Date.now()) {
  if (!isFinite(lat) || !isFinite(lng)) return;
  if (typeof accuracy === 'number' && accuracy > 60) return; // posición mala: no sirve para medir paradas
  points.push({ lat, lng, at, acc: accuracy });
  const cut = at - KEEP_MS;
  if (points.length > MAX_POINTS || points[0].at < cut) points = points.filter(p => p.at >= cut).slice(-MAX_POINTS);
}

/** Solo para la vista previa y las pruebas. */
export function setDriverPositions(list) {
  points = Array.isArray(list) ? list.slice() : [];
}

function meters(a, b) {
  const R = 6371000, toRad = (x) => x * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Paradas (lugares donde estuvo al menos minMs dentro de radiusM), de la más vieja a la más nueva:
 * [{ lat, lng, start, end, ms, ongoing }]
 * El GPS casi no manda posiciones con el teléfono quieto: una parada dura hasta la primera posición
 * de afuera (o hasta ahora, si sigue ahí), con un máximo de 3 min sin datos.
 */
export function findDwells({ minMs = 60000, radiusM = 40, now = Date.now(), list = points } = {}) {
  const out = [];
  let cl = null;
  const close = (endAt, ongoing) => {
    if (!cl) return;
    const end = Math.min(endAt, cl.last + MAX_GAP_MS);
    const ms = end - cl.start;
    if (ms >= minMs) out.push({ lat: cl.lat, lng: cl.lng, start: cl.start, end, ms, ongoing });
  };
  for (const p of list) {
    if (cl && meters(cl, p) <= radiusM) {
      cl.n += 1;
      cl.lat += (p.lat - cl.lat) / cl.n;
      cl.lng += (p.lng - cl.lng) / cl.n;
      cl.last = p.at;
      continue;
    }
    close(p.at, false);
    cl = { lat: p.lat, lng: p.lng, n: 1, start: p.at, last: p.at };
  }
  close(now, true);
  return out;
}

/**
 * La parada que corresponde a una compra que se confirma ahora:
 * - empezó después de aceptar el pedido (o de terminar el comercio anterior): no vale la espera previa;
 * - sigue en curso o terminó hace poco (si desliza tarde, igual se usa donde estuvo).
 * Si deslizó antes de llegar, no hay parada que cumpla y devuelve null: no se aprende nada.
 */
export function purchaseDwell({ since = 0, now = Date.now(), maxAgeMs = 5 * 60 * 1000, list = points } = {}) {
  const dwells = findDwells({ now, list }).filter(d => d.start >= since - 30000 && (d.ongoing || now - d.end <= maxAgeMs));
  return dwells.length ? dwells[dwells.length - 1] : null;
}
