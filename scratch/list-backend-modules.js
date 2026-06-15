import fs from 'fs';
import path from 'path';

const searchDir = 'c:\\Users\\PC\\Desktop\\Kiosco\\apps\\backend\\src\\modules';

function listDirRecursive(dir) {
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      console.log(`[DIR] ${fullPath}`);
      listDirRecursive(fullPath);
    } else {
      console.log(`  [FILE] ${fullPath}`);
    }
  }
}

listDirRecursive(searchDir);
process.exit(0);
