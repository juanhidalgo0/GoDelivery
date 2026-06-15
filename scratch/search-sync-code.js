import fs from 'fs';
import path from 'path';

const searchDirs = [
  'c:\\Users\\PC\\Desktop\\Kiosco\\src',
  'c:\\Users\\PC\\Desktop\\Kiosco\\apps'
];

function searchFiles(dir) {
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      searchFiles(fullPath);
    } else {
      if (file.endsWith('.js') || file.endsWith('.ts') || file.endsWith('.json')) {
        const content = fs.readFileSync(fullPath, 'utf8');
        const lines = content.split('\n');
        lines.forEach((line, index) => {
          if (line.includes('resolveComercioIdByEmail') || line.includes('resolveComercioIdByName')) {
            console.log(`${fullPath}:${index + 1}: ${line.trim()}`);
          }
        });
      }
    }
  }
}

searchDirs.forEach(dir => searchFiles(dir));
process.exit(0);
