import fs from 'fs';
import path from 'path';

const searchDirs = [
  'c:\\Users\\PC\\Desktop',
  'c:\\Users\\PC\\Desktop\\GoDelivery'
];

function isKeystore(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(4);
    fs.readSync(fd, buffer, 0, 4, 0);
    fs.closeSync(fd);
    
    // JKS magic number is FEEDFEED
    if (buffer.toString('hex') === 'feedfeed') {
      return 'JKS';
    }
    // PKCS12 magic numbers can start with 3082 (ASN.1 Sequence)
    // Often it starts with 30820b... or similar.
    // Let's check if it is JKS or has extension .jks / .keystore
    return null;
  } catch (err) {
    return null;
  }
}

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
        if (file !== 'node_modules' && file !== '.git' && file !== 'AppData' && file !== 'Local' && file !== 'Local Temp') {
          searchFiles(fullPath);
        }
      } else {
        const ext = path.extname(file).toLowerCase();
        const isKeystoreFile = ext === '.jks' || ext === '.keystore' || file === 'go!' || file.includes('release') || file.includes('key');
        
        if (isKeystoreFile && stat.size > 1000 && stat.size < 10000) {
          console.log(`Found candidate file: ${fullPath} (${stat.size} bytes)`);
          const keystoreType = isKeystore(fullPath);
          if (keystoreType) {
            console.log(`  -> Confirmed magic number: ${keystoreType}`);
          }
        }
      }
    }
  } catch (err) {
    // ignore
  }
}

searchDirs.forEach(dir => searchFiles(dir));
process.exit(0);
