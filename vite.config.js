import { defineConfig } from 'vite';
import { devMaplibreAssets } from './dev-maplibre-assets.js';

export default defineConfig({
  plugins: [devMaplibreAssets()],
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


