import { defineConfig } from 'vite';
import { devMaplibreAssets } from './dev-maplibre-assets.js';

function devSorteoRewrite() {
  return {
    name: 'dev-sorteo-rewrite',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === '/sorteo' || req.url?.startsWith('/sorteo?')) {
          req.url = req.url.replace('/sorteo', '/sorteo.html');
        }
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


