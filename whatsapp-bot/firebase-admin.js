import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (!admin.apps.length) {
  let credential = null;

  // 1. Check if passed as raw JSON string in environment variable (Render / Koyeb / Railway)
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    try {
      const parsed = typeof process.env.FIREBASE_SERVICE_ACCOUNT_JSON === 'string'
        ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
        : process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
      credential = admin.credential.cert(parsed);
      console.log('✅ Firebase Admin inicializado desde variable de entorno FIREBASE_SERVICE_ACCOUNT_JSON');
    } catch (e) {
      console.error('❌ Error parseando FIREBASE_SERVICE_ACCOUNT_JSON:', e.message);
    }
  }

  // 2. Check if local serviceAccountKey.json exists
  if (!credential) {
    const localKeyPath = path.join(__dirname, 'serviceAccountKey.json');
    const parentKeyPath = path.join(__dirname, '..', 'functions', 'serviceAccountKey.json');
    
    if (fs.existsSync(localKeyPath)) {
      credential = admin.credential.cert(JSON.parse(fs.readFileSync(localKeyPath, 'utf8')));
      console.log('✅ Firebase Admin inicializado desde whatsapp-bot/serviceAccountKey.json');
    } else if (fs.existsSync(parentKeyPath)) {
      credential = admin.credential.cert(JSON.parse(fs.readFileSync(parentKeyPath, 'utf8')));
      console.log('✅ Firebase Admin inicializado desde functions/serviceAccountKey.json');
    }
  }

  // 3. Fallback to default application credentials or project ID
  if (!credential) {
    credential = admin.credential.applicationDefault();
    console.log('ℹ️ Usando credenciales por defecto de Google Cloud');
  }

  admin.initializeApp({
    credential,
    projectId: process.env.FIREBASE_PROJECT_ID || 'godelivery-magdalena'
  });
}

export const db = admin.firestore();
export { admin };
export default admin;
