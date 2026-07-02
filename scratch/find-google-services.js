import fs from 'fs';
import path from 'path';

const searchDirs = [
  'c:\\Users\\PC\\Desktop',
  'c:\\Users\\PC\\Desktop\\GoDelivery'
];

function searchFiles(dir) {
  if (!fs.existsSync(dir)) return;
  try {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      let stat;
      try {
        stat = fs.statSync(fullPath);
      } catch (err) {
        continue;
      }
      
      if (stat.isDirectory()) {
        if (file !== 'node_modules' && file !== '.git') {
          searchFiles(fullPath);
        }
      } else {
        if (file === 'google-services.json') {
          console.log(`Found google-services.json: ${fullPath}`);
        }
      }
    }
  } catch (err) {
    // ignore
  }
}

searchDirs.forEach(dir => searchFiles(dir));
process.exit(0);
