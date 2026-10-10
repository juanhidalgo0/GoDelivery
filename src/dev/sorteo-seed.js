// SOLO DESARROLLO: ver el editor de sorteos del admin sin tocar la base real.
//   GO_PREVIEW_SEED=sorteo-seed node node_modules/vite/bin/vite.js --config vite.preview.config.js --port 5179
// Abrir /#/admin/sorteos/demo (el punto vale $1, como en producción si no se cambió).
// Con ?activo=1 el sorteo está abierto: sirve para ver el aviso del inicio (/?activo=1#/).
import { mockDb, Timestamp } from 'firebase/firestore';

const ADMIN = { uid: 'admin-demo', email: 'admin@demo.test', displayName: 'Admin Demo' };
try { localStorage.setItem('gd-onboarding-done', 'true'); localStorage.setItem('gd-whats-new-seen', '999'); } catch (e) {}
window.__mockAuthUser = { ...ADMIN, getIdToken: async () => 'demo', emailVerified: true, providerData: [] };

mockDb.set(`users/${ADMIN.uid}`, { role: 'admin', displayName: ADMIN.displayName, email: ADMIN.email, onboardingCompleted: true });
mockDb.set('settings/global', { dollarPerPoint: 1 });
const ACTIVO = new URLSearchParams(location.search).get('activo') === '1';
mockDb.set('giveaways/demo', {
  title: 'Sorteo de Primavera', subtitle: '$100.000 en Puntos GO para 8 vecinos. Cada pedido suma chances.',
  active: ACTIVO, status: ACTIVO ? 'active' : 'draft', autoDraw: true, targetAudience: 'all',
  endsAt: Timestamp.fromMillis(Date.now() + 3 * 24 * 3600 * 1000),
  prizes: [
    { position: 1, amount: '$70.000', description: 'Crédito GoDelivery', badge: '1º Premio' },
    { position: 2, amount: '$10.000', description: 'Crédito GoDelivery', badge: '2º Premio' }
  ],
  chanceRules: { registration: 1, order: 5, referral: 2, appInstalled: 2 },
  shareMessage: '', totalParticipants: 0, totalChances: 0, winners: []
});
