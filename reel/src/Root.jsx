import React from 'react';
import { Composition } from 'remotion';
import { Brand, BRAND_DURATION } from './Brand.jsx';
import { FPS } from './capture.js';
import { GoCashFeed, GoCashStory } from './GoCash.jsx';
import { MandadosRaros, MANDADOS_DURATION } from './Mandados.jsx';
import { SorteoFeed, SorteoReel, SORTEO_REEL_DURATION } from './Sorteo.jsx';
import { Viajes, VIAJES_DURATION } from './Viajes.jsx';
import { Precio, PRECIO_DURATION } from './Precio.jsx';
import { Tarifas, TARIFAS_DURATION } from './Tarifas.jsx';
import { Fixstore, FIXSTORE_DURATION } from './Fixstore.jsx';
import { Destacadas, HISTORIAS, Portadas, PORTADAS } from './Destacadas.jsx';

// Los anuncios anteriores (Ad.jsx: Pedidos y Mandados) necesitan sus grabaciones en src/captures;
// para volver a renderizarlos, regrabar con flows/pedido-hd.js y flows/mandado-hd.js y sumarlos acá.
export const Root = () => (
  <>
    <Composition id="GoMarca" component={Brand} fps={FPS} width={1080} height={1920} durationInFrames={Math.ceil(BRAND_DURATION * FPS)} />
    {/* Pieza de Go Cash: npx remotion still src/index.js GoCashFeed out/go-cash-feed.png */}
    <Composition id="GoCashFeed" component={GoCashFeed} fps={FPS} width={1080} height={1350} durationInFrames={1} />
    <Composition id="GoCashStory" component={GoCashStory} fps={FPS} width={1080} height={1920} durationInFrames={1} />
    {/* Sorteo de los 1.000 vecinos: npx remotion still src/index.js SorteoFeed out/sorteo-feed.png */}
    <Composition id="SorteoFeed" component={SorteoFeed} fps={FPS} width={1080} height={1350} durationInFrames={1} />
    <Composition id="SorteoReel" component={SorteoReel} fps={FPS} width={1080} height={1920} durationInFrames={Math.ceil(SORTEO_REEL_DURATION * FPS)} />
    {/* Mandados insólitos (chat): npx remotion render src/index.js MandadosRaros out/mandados-raros.mp4 --crf=16 */}
    <Composition id="MandadosRaros" component={MandadosRaros} fps={FPS} width={1080} height={1920} durationInFrames={Math.ceil(MANDADOS_DURATION * FPS)} />
    {/* Viajes en moto: npx remotion render src/index.js GoViajes out/GO-viajes-en-moto.mp4 --crf=16 */}
    <Composition id="GoViajes" component={Viajes} fps={FPS} width={1080} height={1920} durationInFrames={Math.ceil(VIAJES_DURATION * FPS)} />
    {/* Serie "¿Cuánto te sale ir hasta...?": npx remotion render src/index.js PrecioAtalaya out/precio-atalaya.mp4 --crf=16 */}
    {/* Un solo video con todos los destinos: npx remotion render src/index.js GoTarifas out/GO-tarifas-moto.mp4 --crf=16 */}
    <Composition id="GoTarifas" component={Tarifas} fps={FPS} width={1080} height={1920} durationInFrames={Math.ceil(TARIFAS_DURATION * FPS)} />
    <Composition id="PrecioAtalaya" component={Precio} defaultProps={{ destino: 'atalaya' }} fps={FPS} width={1080} height={1920} durationInFrames={Math.ceil(PRECIO_DURATION * FPS)} />
    {/* Fixstore ya está en GO!: npx remotion render src/index.js GoFixstore out/GO-fixstore.mp4 --crf=16 */}
    <Composition id="GoFixstore" component={Fixstore} fps={FPS} width={1080} height={1920} durationInFrames={Math.ceil(FIXSTORE_DURATION * FPS)} />
    {/* Historias destacadas de Instagram: un cuadro por pieza (ver Destacadas.jsx y destacadas.mjs) */}
    <Composition id="GoDestacadas" component={Destacadas} fps={FPS} width={1080} height={1920} durationInFrames={HISTORIAS.length} />
    <Composition id="GoPortadas" component={Portadas} fps={FPS} width={1080} height={1080} durationInFrames={PORTADAS.length} />
  </>
);
