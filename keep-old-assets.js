// Conserva los archivos JS/CSS de los deploys anteriores durante unos días.
//
// Cada build genera archivos con otro nombre (assets/xxx-HASH.js) y el deploy de Hosting borra los
// viejos. Quien tenía la app abierta (o la app nativa, que carga el JS por Hosting) pide después un
// archivo que ya no existe: "Importing a module script failed" / "Failed to fetch dynamically
// imported module" (lo registraba el detector de errores). Guardando los de los últimos días, esa
// pantalla carga igual con su versión y la app se actualiza sola en la próxima apertura.
//
//   node keep-old-assets.js save     antes de vite build (vite vacía dist/)
//   node keep-old-assets.js restore  después del build: vuelve a poner los viejos que falten
import fs from 'fs';
import path from 'path';

const KEEP_DAYS = 10;
const DIST = path.join(process.cwd(), 'dist', 'assets');
const STORE = path.join(process.cwd(), '.asset-history');
const mode = process.argv[2];

function copyNew(from, to) {
  if (!fs.existsSync(from)) return 0;
  fs.mkdirSync(to, { recursive: true });
  let n = 0;
  for (const name of fs.readdirSync(from)) {
    const src = path.join(from, name);
    const dst = path.join(to, name);
    if (!fs.statSync(src).isFile() || fs.existsSync(dst)) continue;
    fs.copyFileSync(src, dst);
    n++;
  }
  return n;
}

if (mode === 'save') {
  const n = copyNew(DIST, STORE);
  // Los que pasaron KEEP_DAYS desde que se guardaron ya no los pide nadie
  let pruned = 0;
  if (fs.existsSync(STORE)) {
    const limit = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
    for (const name of fs.readdirSync(STORE)) {
      const file = path.join(STORE, name);
      if (fs.statSync(file).mtimeMs < limit) { fs.unlinkSync(file); pruned++; }
    }
  }
  console.log(`[Assets viejos] guardados ${n}, borrados ${pruned} de más de ${KEEP_DAYS} días`);
} else if (mode === 'restore') {
  const n = copyNew(STORE, DIST);
  console.log(`[Assets viejos] ${n} archivos de deploys anteriores vuelven a dist/assets`);
} else {
  console.error('Uso: node keep-old-assets.js save|restore');
  process.exit(1);
}
