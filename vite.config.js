import { defineConfig } from 'vite';

export default defineConfig({
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


