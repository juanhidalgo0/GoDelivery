// SOLO DESARROLLO: datos de prueba para ver Admin → Bot WhatsApp con el cupo de mensajes del mes.
//   GO_PREVIEW_SEED=wa-bot-seed node node_modules/vite/bin/vite.js --config vite.preview.config.js --port 5183
// Abrir /#/admin/whatsapp-bot (entra como admin). No lee ni escribe la base real.
import { mockDb } from 'firebase/firestore';

const ADMIN = { uid: 'admin-demo', email: 'admin@demo.test', displayName: 'Admin de prueba' };
try { localStorage.setItem('gd-onboarding-done', 'true'); localStorage.setItem('gd-whats-new-seen', '999'); } catch (e) {}
window.__mockAuthUser = { ...ADMIN, getIdToken: async () => 'demo', emailVerified: true, providerData: [] };
mockDb.set(`users/${ADMIN.uid}`, { role: 'admin', isAdmin: true, displayName: ADMIN.displayName, email: ADMIN.email, onboardingCompleted: true });

const month = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 7);
const sent = Number(new URLSearchParams(location.search).get('enviados') || 640);
mockDb.set(`wa_usage/${month}`, { month, free: 1000, sent, byType: { interactive: Math.round(sent * 0.7), text: Math.round(sent * 0.3) } });
mockDb.set('wa_usage/2026-09', { month: '2026-09', free: 1000, sent: 1900 });
mockDb.set('wa_config/link', { connected: true, via: 'manual', phoneNumberId: '1276606758880187', display: '+1 555 200 4211', name: 'GO! Delivery', quality: 'GREEN', coexistence: false });
mockDb.set('wa_config/test_mode', { enabled: true, numbers: [{ phone: '2215550001', label: 'Prueba' }] });
