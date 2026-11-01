// SOLO DESARROLLO: datos de prueba para Admin → Comercios con la app completa.
//   GO_PREVIEW_SEED=comercios-admin-seed node node_modules/vite/bin/vite.js --config vite.preview.config.js --port 5184
// Abrir /#/admin/comercios (entra como admin). No lee ni escribe la base real.
import { mockDb, Timestamp } from 'firebase/firestore';

const ADMIN = { uid: 'admin-demo', email: 'admin@demo.test', displayName: 'Admin de prueba' };
try { localStorage.setItem('gd-onboarding-done', 'true'); localStorage.setItem('gd-whats-new-seen', '999'); } catch (e) {}
window.__mockAuthUser = { ...ADMIN, getIdToken: async () => 'demo', emailVerified: true, providerData: [] };
mockDb.set(`users/${ADMIN.uid}`, { role: 'admin', isAdmin: true, displayName: ADMIN.displayName, email: ADMIN.email, onboardingCompleted: true });

const names = ['Pizzería Los Sabores', 'Carnicería El Gaucho', 'Kiosco Paulos', 'Heladería Nieve', 'Farmacia Central', 'Verdulería Doña Rosa', 'Lumal', 'Fixstore'];
names.forEach((name, i) => {
  const id = `c${i + 1}`;
  mockDb.set(`comercios/${id}`, { name, category: i % 2 ? 'Mercado' : 'Restaurante', ownerId: i === 7 ? null : `owner${i}`, approvedByAdmin: i !== 5, phone: '2221000000', isOpen: true });
  mockDb.set(`users/owner${i}`, { role: 'comercio', isComercio: true, email: `dueno${i}@demo.test` });
});

// Muchos pedidos sin comisión (como la base real desde que la comisión está apagada) y unos pocos con deuda
let n = 0;
for (let i = 0; i < 600; i++) {
  const c = `c${(i % names.length) + 1}`;
  mockDb.set(`orders/o${++n}`, { comercioId: c, total: 5000 + (i % 7) * 900, status: i % 11 ? 'delivered' : 'cancelled', isSettled: false, commissionAmount: 0, commissionStatus: 'waived', createdAt: Timestamp.fromMillis(Date.now() - i * 3600000) });
}
mockDb.set(`orders/o${++n}`, { comercioId: 'c1', total: 12000, status: 'delivered', isSettled: false, commissionAmount: 1200, commissionStatus: 'pending', createdAt: Timestamp.now() });
mockDb.set(`orders/o${++n}`, { comercioId: 'c2', total: 8000, status: 'delivered', isSettled: true, commissionAmount: 800, commissionStatus: 'paid', createdAt: Timestamp.now() });
