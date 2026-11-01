import { defineConfig } from 'vite';
import { devMaplibreAssets } from './dev-maplibre-assets.js';
import { resolve } from 'path';

function devSorteoRewrite() {
  return {
    name: 'dev-sorteo-rewrite',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === '/sorteo' || req.url?.startsWith('/sorteo?')) {
          req.url = req.url.replace('/sorteo', '/sorteo.html');
        }
        // Seguimiento en vivo de WhatsApp (en Hosting: rewrite de firebase.json)
        if (req.url?.startsWith('/en-vivo/')) req.url = '/en-vivo.html';
        next();
      });
    }
  };
}

export default defineConfig({
  plugins: [devMaplibreAssets(), devSorteoRewrite()],
  define: {
    __APP_BUILD_TIME__: JSON.stringify(Date.now()),
  },
  optimizeDeps: {
    exclude: ['maplibre-gl'],
  },
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      // en-vivo.html: seguimiento en vivo de los pedidos de WhatsApp (src/en-vivo.js)
      input: { main: resolve(__dirname, 'index.html'), envivo: resolve(__dirname, 'en-vivo.html') },
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/firebase')) {
            return 'firebase-vendor';
          }
          if (id.includes('node_modules/maplibre-gl')) {
            return 'maplibre-vendor';
          }
          if (id.includes('node_modules/@capacitor')) {
            return 'capacitor-vendor';
          }
        },
      },
    },
  },
});


