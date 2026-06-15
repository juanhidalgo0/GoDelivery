import fs from 'fs';
import path from 'path';

const searchDirs = [
  'c:\\Users\\PC\\Desktop\\Kiosco',
  'c:\\Users\\PC\\Desktop\\Kiosco - Copy'
];

searchDirs.forEach(dir => {
  const filePath = path.join(dir, 'godelivery_comercio_id.txt');
  if (fs.existsSync(filePath)) {
    console.log(`=== ${filePath} ===`);
    console.log(fs.readFileSync(filePath, 'utf8').trim());
  } else {
    console.log(`No file in ${dir}`);
  }
});
process.exit(0);
