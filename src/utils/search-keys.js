// Palabras para buscar productos: las mismas reglas que functions/ventra-bridge.js (searchKeys).
// Minúsculas, sin tildes, separadas por todo lo que no sea letra o número.
export function normalizeSearch(text) {
  return String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function searchTokens(text) {
  return normalizeSearch(text).split(/[^a-z0-9ñ]+/).filter((w) => w.length >= 1);
}

/** searchKeys de un producto (igual que el puente con Ventra): prefijos de 2 a 10 letras de cada palabra */
export function buildSearchKeys(name, barcode) {
  const keys = new Set();
  for (const w of searchTokens(name).filter((x) => x.length >= 2).slice(0, 12)) {
    for (let i = 2; i <= Math.min(w.length, 10); i++) keys.add(w.slice(0, i));
  }
  if (barcode) keys.add(String(barcode));
  return [...keys].slice(0, 120);
}
