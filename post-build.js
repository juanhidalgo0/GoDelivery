import fs from 'fs';
import path from 'path';

const timestamp = Date.now();

// 1. Update Service Worker CACHE_NAME in firebase-messaging-sw.js
const swPath = path.join(process.cwd(), 'dist', 'firebase-messaging-sw.js');
if (fs.existsSync(swPath)) {
  try {
    let content = fs.readFileSync(swPath, 'utf8');
    content = content.replace(
      /const CACHE_NAME = ['"`]godelivery-v[\d\.]+['"`]/g,
      `const CACHE_NAME = 'godelivery-v${timestamp}'`
    );
    fs.writeFileSync(swPath, content, 'utf8');
    console.log(`[Post-Build] Updated firebase-messaging-sw.js Cache Name to godelivery-v${timestamp}`);
  } catch (err) {
    console.error('[Post-Build] Error updating firebase-messaging-sw.js:', err);
  }
}

// 2. Update Service Worker CACHE_NAME in sw.js (main app SW)
const mainSwPath = path.join(process.cwd(), 'dist', 'sw.js');
if (fs.existsSync(mainSwPath)) {
  try {
    let content = fs.readFileSync(mainSwPath, 'utf8');
    content = content.replace(
      /const CACHE_NAME = ['"`]godelivery-v[\d\.]+['"`][^;]*/,
      `const CACHE_NAME = 'godelivery-v${timestamp}';`
    );
    fs.writeFileSync(mainSwPath, content, 'utf8');
    console.log(`[Post-Build] Updated sw.js Cache Name to godelivery-v${timestamp}`);
  } catch (err) {
    console.error('[Post-Build] Error updating sw.js:', err);
  }
}

// 3. Inject timestamp into built JS bundles in dist/assets/
const assetsDir = path.join(process.cwd(), 'dist', 'assets');
if (fs.existsSync(assetsDir)) {
  const files = fs.readdirSync(assetsDir);
  for (const file of files) {
    if (file.endsWith('.js')) {
      const filePath = path.join(assetsDir, file);
      let content = fs.readFileSync(filePath, 'utf8');
      if (content.includes('__APP_BUILD_TIME_PLACEHOLDER__')) {
        content = content.replaceAll('__APP_BUILD_TIME_PLACEHOLDER__', String(timestamp));
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`[Post-Build] Injected build timestamp ${timestamp} into ${file}`);
      }
    }
  }
}

// 4. Write version.json metadata file to dist and public
try {
  const versionData = JSON.stringify({ version: timestamp });
  fs.writeFileSync(path.join(process.cwd(), 'dist', 'version.json'), versionData, 'utf8');
  fs.writeFileSync(path.join(process.cwd(), 'public', 'version.json'), versionData, 'utf8');
  console.log(`[Post-Build] Wrote version.json with version ${timestamp}`);
} catch (err) {
  console.error('[Post-Build] Error writing version file:', err);
}

// 5. Inject timestamp into dist/index.html
const distIndexPath = path.join(process.cwd(), 'dist', 'index.html');
if (fs.existsSync(distIndexPath)) {
  try {
    let content = fs.readFileSync(distIndexPath, 'utf8');
    if (content.includes('__APP_BUILD_TIME_PLACEHOLDER__')) {
      content = content.replaceAll('__APP_BUILD_TIME_PLACEHOLDER__', String(timestamp));
      fs.writeFileSync(distIndexPath, content, 'utf8');
      console.log(`[Post-Build] Injected build timestamp ${timestamp} into dist/index.html`);
    }
  } catch (err) {
    console.error('[Post-Build] Error updating dist/index.html:', err);
  }
}

// 6. Ensure MapLibre Worker files are in dist/assets and dist/
try {
  const maplibreDist = path.join(process.cwd(), 'node_modules', 'maplibre-gl', 'dist');
  const filesToCopy = ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs'];
  for (const f of filesToCopy) {
    const src = path.join(maplibreDist, f);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(process.cwd(), 'dist', 'assets', f));
      fs.copyFileSync(src, path.join(process.cwd(), 'dist', f));
    }
  }
  console.log('[Post-Build] Copied MapLibre worker files to dist/assets');
} catch (err) {
  console.error('[Post-Build] Error copying MapLibre worker files:', err);
}
