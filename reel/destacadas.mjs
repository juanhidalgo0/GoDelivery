// Renderiza las historias destacadas y las portadas, y les pone nombre (out/destacadas/<nombre>.png).
// Uso: node destacadas.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const OUT = 'out/destacadas';
const TMP = path.join(OUT, '_tmp');
const jobs = [
  { comp: 'GoDestacadas', names: ['como-pedir-1', 'como-pedir-2', 'como-pedir-3', 'como-pedir-4', 'mandados-1', 'mandados-2', 'mandados-3', 'comercios-1', 'comercios-2', 'comercios-3'] },
  { comp: 'GoPortadas', names: ['portada-como-pedir', 'portada-mandados', 'portada-comercios'] },
];
fs.mkdirSync(OUT, { recursive: true });
for (const { comp, names } of jobs) {
  fs.rmSync(TMP, { recursive: true, force: true });
  execSync(`npx remotion render src/index.js ${comp} ${TMP} --sequence --image-format=png --log=error`, { stdio: 'inherit' });
  const files = fs.readdirSync(TMP).filter(f => f.endsWith('.png')).sort();
  if (files.length !== names.length) throw new Error(`${comp}: ${files.length} cuadros, se esperaban ${names.length}`);
  files.forEach((f, i) => fs.renameSync(path.join(TMP, f), path.join(OUT, `${names[i]}.png`)));
}
fs.rmSync(TMP, { recursive: true, force: true });
console.log(fs.readdirSync(OUT).join('\n'));
