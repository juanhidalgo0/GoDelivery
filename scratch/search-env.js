import fs from 'fs';
import path from 'path';

const searchDirs = [
  'c:\\Users\\PC\\Desktop\\Kiosco',
  'c:\\Users\\PC\\Desktop\\Kiosco - Copy',
  'c:\\Users\\PC\\Desktop\\maxikiosco-pos-reestructured'
];

searchDirs.forEach(dir => {
  try {
    const envPath = path.join(dir, '.env');
    if (fs.existsSync(envPath)) {
      console.log(`=== ${envPath} ===`);
      console.log(fs.readFileSync(envPath, 'utf8'));
    }
  } catch (err) {
    console.error(`Error reading in ${dir}:`, err.message);
  }
});
process.exit(0);
