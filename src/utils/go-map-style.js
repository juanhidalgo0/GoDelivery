// Mapa propio de GO: Magdalena y alrededores servido desde nuestro Firebase Hosting (public/map).
// Datos de OpenStreetMap (vía Protomaps), sin claves, sin límites y sin depender de terceros.
// Claro para el cliente, "GO oscuro" para el repartidor (mismos colores que su mapa de siempre).
//
// Para actualizar el mapa (una o dos veces por año alcanza): ver public/map/README.md
import LAYERS from './go-map-layers.json';

// Zona descargada: fuera de acá no hay mapa (no se piden pedazos que no existen)
export const GO_MAP_BOUNDS = [-57.78, -35.36, -57.24, -34.94];
export const GO_MAP_CENTER = [-57.5146, -35.0811];

export function goMapStyle(theme = 'light') {
  const base = (typeof location !== 'undefined' && location.origin && location.origin !== 'null') ? location.origin : 'https://godelivery-magdalena.web.app';
  const dark = theme === 'dark';
  return {
    version: 8,
    glyphs: `${base}/map/fonts/{fontstack}/{range}.pbf`,
    sprite: `${base}/map/sprites/${dark ? 'dark' : 'light'}`,
    sources: {
      protomaps: {
        type: 'vector',
        tiles: [`${base}/map/tiles/{z}/{x}/{y}.pbf`],
        minzoom: 0,
        maxzoom: 15,
        bounds: GO_MAP_BOUNDS,
        attribution: '© <a href="https://openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
      },
    },
    layers: dark ? LAYERS.goDark : LAYERS.light,
  };
}
