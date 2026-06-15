import { execSync } from 'child_process';

const keystorePath = 'c:\\Users\\PC\\Desktop\\GoANDROID\\go!';
const keytoolPath = '"C:\\Program Files\\Android\\Android Studio\\jbr\\bin\\keytool.exe"';

const basePassword = 'osopolar77912879';

// Generate variations of the base password
const variations = new Set([
  basePassword,
  'osopolar77912879',
  'OsoPolar77912879',
  'Osopolar77912879',
  'osopolar',
  'OsoPolar',
  'osopolar779',
  'osopolar7791',
  'osopolar77912',
  'osopolar779128',
  'osopolar7791287',
  'osopolar77912879!',
  'osopolar77912879.',
  'osopolar77912879_',
  'osopolar77912879*',
  'osopolar77912879#',
  'osopolar2026',
  'osopolar2025',
  'osopolar2024',
  'osopolar2023',
  'osopolar779128790',
  'osopolar779128791',
  'osopolar779128792',
  'osopolar779128793',
  'osopolar779128794',
  'osopolar779128795',
  'osopolar779128796',
  'osopolar779128797',
  'osopolar779128798',
  'osopolar779128799',
  'osopolar123',
  'osopolar1234',
  'osopolar12345',
  'osopolar123456',
  'osopolar77912879a',
  'osopolar77912879b',
  'osopolar77912879c',
  'osopolar77912879d',
  'osopolar77912879e',
  'osopolar77912879f',
  'osopolar77912879g',
  'osopolar77912879h',
  'osopolar77912879i',
  'osopolar77912879j',
  'osopolar77912879k',
  'osopolar77912879l',
  'osopolar77912879m',
  'osopolar77912879n',
  'osopolar77912879o',
  'osopolar77912879p',
  'osopolar77912879q',
  'osopolar77912879r',
  'osopolar77912879s',
  'osopolar77912879t',
  'osopolar77912879u',
  'osopolar77912879v',
  'osopolar77912879w',
  'osopolar77912879x',
  'osopolar77912879y',
  'osopolar77912879z',
  // Capitalization variations
  basePassword.toLowerCase(),
  basePassword.toUpperCase(),
]);

console.log(`Testing ${variations.size} password variations...`);

for (const pass of variations) {
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
