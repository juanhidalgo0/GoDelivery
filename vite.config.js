import { defineConfig } from 'vite';

export default defineConfig({
  define: {
    __APP_BUILD_TIME__: JSON.stringify(Date.now()),
  },
});
