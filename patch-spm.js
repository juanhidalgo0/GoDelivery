import fs from 'fs';
import path from 'path';

const nodeModulesDir = path.join(process.cwd(), 'node_modules');

function walk(dir) {
  let files = [];
  try {
    fs.readdirSync(dir).forEach(file => {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        // Skip nested node_modules to avoid infinite loops or editing sub-dependencies redundantly
        if (file !== 'node_modules') {
          files = files.concat(walk(filePath));
        }
      } else if (file === 'Package.swift') {
        files.push(filePath);
      }
    });
  } catch (e) {
    // Ignore permissions or missing folder errors
  }
  return files;
}

console.log('Searching for Package.swift files in node_modules...');
const packageSwiftFiles = walk(nodeModulesDir);

packageSwiftFiles.forEach(file => {
  try {
    let content = fs.readFileSync(file, 'utf8');
    if (content.includes('capacitor-swift-pm')) {
      console.log(`Patching ${file}`);
      // Replace any from: "..." or exact: "..." with from: "8.0.0" for capacitor-swift-pm
      const newContent = content.replace(
        /(url:\s*"https:\/\/github\.com\/ionic-team\/capacitor-swift-pm\.git"\s*,\s*)(from|exact):\s*"[^"]*"/g,
        '$1from: "8.0.0"'
      );
      if (newContent !== content) {
        fs.writeFileSync(file, newContent, 'utf8');
        console.log(`Successfully patched ${file}`);
      }
    }
  } catch (e) {
    console.error(`Failed to patch ${file}:`, e.message);
  }
});
