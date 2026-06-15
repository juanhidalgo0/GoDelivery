import fs from 'fs';
import path from 'path';

const dir = 'c:\\Users\\PC\\Desktop\\maxikiosco-pos-reestructured';

try {
  if (fs.existsSync(dir)) {
    const files = fs.readdirSync(dir);
    console.log(`Contents of ${dir}:`);
    files.forEach(f => {
      console.log(` - ${f}`);
    });
  } else {
    console.log(`${dir} does not exist.`);
  }
} catch (err) {
  console.error(err);
}
process.exit(0);
