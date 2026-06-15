import fs from 'fs';
import path from 'path';

const searchDirs = [
  'c:\\Users\\PC\\Desktop\\Kiosco',
  'c:\\Users\\PC\\Desktop\\Kiosco - Copy'
];

function findFile(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      if (file !== 'node_modules' && file !== '.git') {
        findFile(fullPath);
      }
    } else {
      if (file === 'godelivery_comercio_id.txt') {
        console.log(`=== Found: ${fullPath} ===`);
        console.log(fs.readFileSync(fullPath, 'utf8').trim());
      }
    }
  }
}

searchDirs.forEach(dir => {
  try {
    findFile(dir);
  } catch (err) {
    console.error(`Error in ${dir}:`, err.message);
  }
});
process.exit(0);
