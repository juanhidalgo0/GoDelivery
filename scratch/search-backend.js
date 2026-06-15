import fs from 'fs';
import path from 'path';

const searchDirs = [
  'c:\\Users\\PC\\Desktop\\Kiosco\\apps\\backend\\src'
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
          if (line.toLowerCase().includes('firebase') || line.toLowerCase().includes('firestore') || line.toLowerCase().includes('sync') || line.toLowerCase().includes('comercio') || line.toLowerCase().includes('env')) {
            console.log(`${fullPath}:${index + 1}: ${line.trim()}`);
          }
        });
      }
    }
  }
}

searchDirs.forEach(dir => searchFiles(dir));
process.exit(0);
