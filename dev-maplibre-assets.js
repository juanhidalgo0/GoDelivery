// SOLO DESARROLLO: sirve /assets/maplibre-gl.css y los workers desde node_modules.
// Al publicar, post-build.js los copia a dist/assets; en desarrollo faltaban y el servidor devolvía
// la página principal en su lugar: el mapa quedaba sin estilos y los marcadores (moto, casa) se
// dibujaban debajo del mapa.
import fs from 'fs';
import path from 'path';

const FILES = { 'maplibre-gl.css': 'text/css', 'maplibre-gl-worker.mjs': 'text/javascript', 'maplibre-gl-shared.mjs': 'text/javascript' };

export function devMaplibreAssets() {
  return {
    name: 'go-dev-maplibre-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = /^\/(?:assets\/)?(maplibre-gl(?:\.css|-worker\.mjs|-shared\.mjs))(?:\?.*)?$/.exec(req.url || '');
        if (!m) return next();
        const file = path.join(server.config.root || process.cwd(), 'node_modules', 'maplibre-gl', 'dist', m[1]);
        if (!fs.existsSync(file)) return next();
        res.setHeader('Content-Type', FILES[m[1]] + '; charset=utf-8');
        fs.createReadStream(file).pipe(res);
      });
    },
  };
}
