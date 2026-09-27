// SOLO DESARROLLO: servidor de vistas previas con Firebase simulado en memoria.
//   node node_modules/vite/bin/vite.js --config vite.preview.config.js --port 5175
// Abrir /?caso=comercio-en-camino#/pedido/demo (casos en src/dev/tracking-seed.js).
// No lee ni escribe la base real.
import { defineConfig } from 'vite';
import { devMaplibreAssets } from './dev-maplibre-assets.js';
import path from 'path';

const MOCK_DIR = path.resolve(__dirname, 'src/dev/mock-firebase');
const SRC_DIR = path.resolve(__dirname, 'src');

// Solo el código de la app usa la base simulada (las librerías siguen con Firebase real, sin uso en web)
const mockFirebase = {
  name: 'go-preview-mock-firebase',
  enforce: 'pre',
  resolveId(source, importer) {
    const m = /^firebase\/(firestore|app|auth|storage|messaging)$/.exec(source);
    if (!m || !importer) return null;
    const from = path.resolve(importer.split('?')[0]);
    if (!from.startsWith(SRC_DIR) || from.startsWith(MOCK_DIR)) return null;
    return path.join(MOCK_DIR, m[1] === 'firestore' ? 'firestore.js' : 'others.js');
  },
};

// Carga los datos de prueba antes que la app (los módulos se ejecutan en orden)
const seedPlugin = {
  name: 'go-preview-seed',
  // Sin service worker: guardaría la página y dejaría de cargar los datos de prueba
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (/^\/(sw|firebase-messaging-sw)\.js/.test(req.url || '')) { res.statusCode = 404; res.end(); return; }
      next();
    });
  },
  transformIndexHtml: {
    order: 'pre',
    handler(html) {
      return html.replace(/<script type="module" src="\/src\/main\.js[^"]*"><\/script>/,
        (tag) => `<script type="module" src="/src/dev/tracking-seed.js"></script>\n${tag}`);
    },
  },
};

export default defineConfig({
  plugins: [mockFirebase, seedPlugin, devMaplibreAssets()],
  define: { __APP_BUILD_TIME__: JSON.stringify(Date.now()) },
  optimizeDeps: { exclude: ['maplibre-gl', 'firebase'] },
  cacheDir: 'node_modules/.vite-preview',
});
