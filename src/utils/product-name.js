// Nombres de productos para mostrar.
/**
 * Nombres como los carga la caja ("COCA COLA X 2.25") → "Coca Cola x 2.25". Solo si vienen casi todo en
 * mayúsculas: lo que el comercio escribió con cuidado queda como está.
 */
const SMALL = new Set(['de', 'del', 'la', 'el', 'y', 'con', 'sin', 'en', 'para', 'por', 'a', 'al', 'x', 'c/', 's/', 'p/']);
const UNITS = new Set(['gr', 'g', 'grs', 'gs', 'gms', 'kg', 'ml', 'cc', 'cm3', 'cm', 'l', 'lt', 'lts', 'ltro', 'ltros', 'mts', 'mt', 'm', 'un', 'u', 'w', 'mg']);
export function displayName(name) {
  const s = String(name || '').trim().replace(/\s+/g, ' ');
  const letters = s.replace(/[^a-záéíóúñü]/gi, '');
  const upper = s.replace(/[^A-ZÁÉÍÓÚÑÜ]/g, '');
  if (!letters || upper.length / letters.length < 0.7) return s;
  return s.split(' ').map((w, i) => {
    const low = w.toLowerCase();
    if (/\d/.test(w) || UNITS.has(low.replace(/[.,]$/, ''))) return low;
    if (i > 0 && SMALL.has(low)) return low;
    // Siglas cortas sin vocales (KS, BBQ, DDL): quedan en mayúsculas
    if (w.length <= 4 && !/[AEIOUÁÉÍÓÚ]/.test(w)) return w;
    return low.charAt(0).toUpperCase() + low.slice(1);
  }).join(' ');
}
