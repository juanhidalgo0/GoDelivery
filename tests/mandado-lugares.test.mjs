// node tests/mandado-lugares.test.mjs
import assert from 'node:assert/strict';
import { resolvePlaceByName, resolveMandadoStores } from '../src/utils/mandado-places.js';

const lugar = (name, lat, lng, extra = {}) => ({ name, lat, lng, source: 'aprendido', trusted: true, ...extra });
const LISTA = [
  lugar('Carniceria san javier', -35.0806, -57.5153, { category: 'carniceria' }),
  lugar('Carnicería lucas Ludueña', -35.0825, -57.5062, { category: 'carniceria' }),
  lugar('Supermercado Rivadavia', -35.0806, -57.5154, { category: 'supermercado' }),
  lugar('Polleria castelli', -35.09, -57.52, { category: 'polleria' }),
  lugar('Aruba', -35.07, -57.51),
  lugar('Almacén gonmar', -35.08, -57.51, { trusted: false, category: 'almacen' }),
];
const nombre = (t) => resolvePlaceByName(t, LISTA)?.name ?? null;

// Casos que deben encontrar el lugar
assert.equal(nombre('Carnicería San Javier'), 'Carniceria san javier');
assert.equal(nombre('Carnicería Ludueña'), 'Carnicería lucas Ludueña');
assert.equal(nombre('Castelli'), 'Polleria castelli');
assert.equal(nombre('Super rivadavia'), 'Supermercado Rivadavia');

// Casos reales que iban al comercio equivocado
assert.equal(nombre('polleria san javier'), null);
assert.equal(nombre('Polleria Chacabuco y Rivadavia'), null);
assert.equal(nombre('Almacen Taty.(Calle Miguens entre Rivadavia y brenan)'), null);
assert.equal(nombre('Carniceria el gaucho (aruba)'), null);

const paradas = (stops, driver = { lat: -35.0825, lng: -57.5065 }) => resolveMandadoStores({ mandadoStops: stops, deliveryCoords: { lat: -35.083, lng: -57.507 } }, driver, LISTA);

// El caso reportado: pidió "Carnicería" y aclaró San Javier en el detalle
const [cercana] = paradas([{ store: 'Carnicería', nearest: 'carniceria', items: 'Si está abierta San Javier' }]);
assert.equal(cercana.placeName, 'Carnicería');
assert.equal(cercana.placeHint, 'Más cerca: Carnicería lucas Ludueña');
assert.equal(cercana.resolvedBy, 'cercano');

// Lo que escribió el cliente siempre queda como nombre
const [escrita] = paradas([{ store: 'Carnicería Ludueña', items: 'picada' }]);
assert.equal(escrita.placeName, 'Carnicería Ludueña');
assert.equal(escrita.placeHint, 'Mapa: Carnicería lucas Ludueña');
assert.ok(escrita.coords);

// Una sola visita no da ubicación, y sin lugar queda el texto del cliente
const [unaVisita] = paradas([{ store: 'Almacén gonmar', items: 'yerba' }]);
assert.equal(unaVisita.coords, null);
assert.equal(unaVisita.placeName, 'Almacén gonmar');
const [otra] = paradas([{ store: 'polleria san javier', items: 'pollo' }]);
assert.equal(otra.coords, null);
assert.equal(otra.placeName, 'polleria san javier');

console.log('mandado-lugares: ok');
