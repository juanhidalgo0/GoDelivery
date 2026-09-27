# Mapa propio de Magdalena

Datos de OpenStreetMap (via Protomaps), servidos desde Firebase Hosting. Sin claves ni limites.

Para actualizarlo (1 o 2 veces por ano):

1. En una carpeta aparte: `npm i pmtiles@4 @protomaps/basemaps@5`
2. `node scripts/extract.mjs AAAAMMDD ./tiles` (fecha de https://maps.protomaps.com/builds)
3. `node scripts/build-assets.mjs` (copia tiles, letras e iconos y regenera src/utils/go-map-layers.json)
