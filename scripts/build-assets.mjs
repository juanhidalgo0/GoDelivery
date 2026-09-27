// Arma todo lo del mapa propio en GoDelivery/public/map:
//   tiles/ (Magdalena), fonts/ (letras), sprites/ (íconos) y las capas de los estilos claro y GO oscuro.
import { namedFlavor, layers } from '@protomaps/basemaps';
import fs from 'fs';
import path from 'path';

const DEST = 'C:/Users/PC/Desktop/GoDelivery/public/map';
const ASSETS = 'https://protomaps.github.io/basemaps-assets';
fs.mkdirSync(DEST, { recursive: true });

// 1. Tiles
fs.cpSync('./tiles', path.join(DEST, 'tiles'), { recursive: true });

// 2. Letras (solo los rangos del español) e íconos
const FONTS = ['Noto Sans Regular', 'Noto Sans Medium', 'Noto Sans Italic'];
const RANGES = ['0-255', '256-511', '8192-8447'];
for (const f of FONTS) {
  const dir = path.join(DEST, 'fonts', f);
  fs.mkdirSync(dir, { recursive: true });
  for (const r of RANGES) {
    const res = await fetch(`${ASSETS}/fonts/${encodeURIComponent(f)}/${r}.pbf`);
    if (!res.ok) throw new Error(`letra ${f} ${r}: ${res.status}`);
    fs.writeFileSync(path.join(dir, `${r}.pbf`), Buffer.from(await res.arrayBuffer()));
  }
}
for (const theme of ['light', 'dark']) {
  const dir = path.join(DEST, 'sprites');
  fs.mkdirSync(dir, { recursive: true });
  for (const suffix of ['.json', '.png', '@2x.json', '@2x.png']) {
    const res = await fetch(`${ASSETS}/sprites/v4/${theme}${suffix}`);
    if (!res.ok) throw new Error(`sprite ${theme}${suffix}: ${res.status}`);
    fs.writeFileSync(path.join(dir, `${theme}${suffix}`), Buffer.from(await res.arrayBuffer()));
  }
}

// 3. Estilos: claro (cliente) y GO oscuro (repartidor, mismos colores que su mapa de hoy)
const goDark = {
  ...namedFlavor('dark'),
  background: '#11151B', earth: '#11151B', buildings: '#171C24', water: '#0D1A27', ocean_label: '#5E7189',
  park_a: '#132019', park_b: '#15241C', wood_a: '#131B17', wood_b: '#131B17', scrub_a: '#141A18', scrub_b: '#141A18',
  hospital: '#1A1719', industrial: '#15181E', school: '#17171D', pedestrian: '#161B22', aerodrome: '#161B22', sand: '#171A1D', beach: '#1A1C1F',
  other: '#232A34', minor_service: '#232A34', minor_a: '#29313D', minor_b: '#262D38', link: '#36404F', major: '#36404F', highway: '#3E4A5B',
  minor_service_casing: '#0D1116', minor_casing: '#0D1116', link_casing: '#0D1116', major_casing_early: '#0D1116', major_casing_late: '#0D1116',
  highway_casing_early: '#0D1116', highway_casing_late: '#0D1116',
  bridges_other: '#232A34', bridges_minor: '#29313D', bridges_link: '#36404F', bridges_major: '#36404F', bridges_highway: '#3E4A5B',
  roads_label_minor: '#7C8593', roads_label_minor_halo: '#11151B', roads_label_major: '#9AA2AD', roads_label_major_halo: '#11151B',
  subplace_label: '#7C8593', subplace_label_halo: '#11151B', city_label: '#AEB6C1', city_label_halo: '#11151B',
  address_label: '#5E6673', address_label_halo: '#11151B', boundaries: '#3A4352',
};
const out = {
  light: layers('protomaps', namedFlavor('light'), { lang: 'es' }),
  goDark: layers('protomaps', goDark, { lang: 'es' }),
};
fs.writeFileSync('C:/Users/PC/Desktop/GoDelivery/src/utils/go-map-layers.json', JSON.stringify(out));
console.log('listo:', out.light.length, 'capas claras,', out.goDark.length, 'oscuras');
