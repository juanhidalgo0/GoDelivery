import fs from 'fs';
import path from 'path';

const timestamp = Date.now();

// 1. Update Service Worker CACHE_NAME in built file
const swPath = path.join(process.cwd(), 'dist', 'firebase-messaging-sw.js');
if (fs.existsSync(swPath)) {
  try {
    let content = fs.readFileSync(swPath, 'utf8');
    content = content.replace(
      /const CACHE_NAME = ['"`]godelivery-v[\d\.]+['"`]/g,
      `const CACHE_NAME = 'godelivery-v${timestamp}'`
    );
    fs.writeFileSync(swPath, content, 'utf8');
    console.log(`[Post-Build] Updated Service Worker Cache Name to godelivery-v${timestamp}`);
  } catch (err) {
    console.error('[Post-Build] Error updating service worker:', err);
  }
}

// 2. Write version.json metadata file to dist and public
try {
  const versionData = JSON.stringify({ version: timestamp });
  fs.writeFileSync(path.join(process.cwd(), 'dist', 'version.json'), versionData, 'utf8');
  fs.writeFileSync(path.join(process.cwd(), 'public', 'version.json'), versionData, 'utf8');
  console.log(`[Post-Build] Wrote version.json with version ${timestamp}`);
} catch (err) {
  console.error('[Post-Build] Error writing version file:', err);
}
