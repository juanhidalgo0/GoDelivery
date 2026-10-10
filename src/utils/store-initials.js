/** Iniciales del comercio sin conectores: "Almacén y Fiambrería" → "AF". */
export function storeInitials(name) {
  const skip = new Set(['y', 'e', 'de', 'del', 'la', 'el', 'los', 'las', 'en', 'a']);
  const words = String(name || '').split(/\s+/).filter(w => w && !skip.has(w.toLowerCase()));
  return (words.length ? words : [String(name || 'GO')]).slice(0, 2).map(w => w[0]).join('').toUpperCase();
}
