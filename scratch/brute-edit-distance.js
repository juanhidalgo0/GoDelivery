import { execSync } from 'child_process';

const keystorePath = 'c:\\Users\\PC\\Desktop\\GoANDROID\\go!';
const keytoolPath = '"C:\\Program Files\\Android\\Android Studio\\jbr\\bin\\keytool.exe"';
const target = 'osopolar77912879';

const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$.*-_';

// Generate edit distance 1 variations
const candidates = new Set();

// 1. Deletions
for (let i = 0; i < target.length; i++) {
  candidates.add(target.slice(0, i) + target.slice(i + 1));
}

// 2. Substitutions
for (let i = 0; i < target.length; i++) {
  for (const char of alphabet) {
    candidates.add(target.slice(0, i) + char + target.slice(i + 1));
  }
}

// 3. Insertions
for (let i = 0; i <= target.length; i++) {
  for (const char of alphabet) {
    candidates.add(target.slice(0, i) + char + target.slice(i));
  }
}

// 4. Case changes
candidates.add('OsoPolar77912879');
candidates.add('Osopolar77912879');
candidates.add('osopolar77912879');
candidates.add('OSOPOLAR77912879');

console.log(`Generated ${candidates.size} candidate variations of edit distance 1.`);

let count = 0;
for (const pass of candidates) {
  count++;
  if (count % 500 === 0) {
    console.log(`Tested ${count} candidates...`);
  }
  try {
    const cmd = `${keytoolPath} -list -keystore "${keystorePath}" -storepass "${pass}"`;
    execSync(cmd, { stdio: 'ignore' });
    console.log(`\n🎉 SUCCESS! Found correct password: "${pass}"`);
    process.exit(0);
  } catch (err) {
    // Keep trying
  }
}

console.log('No matching variation found.');
process.exit(1);
