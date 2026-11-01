// SOLO DESARROLLO: datos de prueba para ver Admin → Campañas Push → Automáticas.
//   GO_PREVIEW_SEED=automaticas-seed node node_modules/vite/bin/vite.js --config vite.preview.config.js --port 5182
// Abrir /#/admin/broadcasts/automations (entra como admin). No lee ni escribe la base real.
import { mockDb } from 'firebase/firestore';

const ADMIN = { uid: 'admin-demo', email: 'admin@demo.test', displayName: 'Admin de prueba' };
try { localStorage.setItem('gd-onboarding-done', 'true'); localStorage.setItem('gd-whats-new-seen', '999'); } catch (e) {}
window.__mockAuthUser = { ...ADMIN, getIdToken: async () => 'demo', emailVerified: true, providerData: [] };
mockDb.set(`users/${ADMIN.uid}`, { role: 'admin', isAdmin: true, displayName: ADMIN.displayName, email: ADMIN.email, onboardingCompleted: true });

const A = (id, d) => mockDb.set(`automated_broadcasts/${id}`, { version: 2, targetAudience: 'clients', requireDrivers: true, ...d });

A('mandados_manana', {
  name: 'Mandados de mañana', icon: '🛍️', enabled: true, days: [1, 6], time: '10:30', url: '/#/mandados', categories: [],
  description: 'Lo más pedido de GO!. Pico de 10 a 13 h. No depende de comercios abiertos.',
  lastResult: { date: '2026-10-12', status: 'sent', text: 'Enviada a 851 dispositivos: "¿Te faltó algo? 🛍️"' },
  variants: [
    { title: '¿Te faltó algo? 🛍️', body: 'Decinos qué necesitás y en qué comercio. Lo compramos y te lo llevamos.' },
    { title: 'Arrancá el {dia} sin vueltas ☀️', body: 'Los mandados te los hacemos nosotros. Pedilos desde GO!' },
    { title: '¿Llueve y te falta algo? ☔', body: 'No te mojes: pedí un mandado en GO! y te lo llevamos.', lluvia: true },
  ],
});
A('cena_finde', {
  name: 'Cena de viernes y sábado', icon: '🍔', enabled: true, days: [5, 6], time: '20:30', url: '/#/category/Comida', categories: ['Comida', 'Pizzería'],
  description: 'La noche más fuerte de la semana.',
  lastResult: { date: '2026-10-10', status: 'skipped', text: 'Hubo o hay una campaña manual a menos de 6 h' },
  variants: [
    { title: 'Es {dia}, ¿qué pedimos? 🍔', body: 'Hoy la cena te llega a casa. Abrí GO! y elegí algo rico.' },
    { title: 'Hoy pinta {comercio} 🤤', body: 'Ya está abierto. Pedí por GO! y seguí tu pedido en vivo.' },
  ],
});
A('almuerzo', {
  name: 'Almuerzo', icon: '🍽️', enabled: false, days: [2, 3, 4, 5, 6], time: '11:45', url: '/#/category/Comida', categories: ['Comida', 'Pizzería'],
  description: 'Apagada: al mediodía abren pocos locales de comida. Prendela si suman más.',
  variants: [{ title: '¿Qué comemos hoy al mediodía? 🍽️', body: 'Pedí tu almuerzo por GO! y olvidate de cocinar.' }],
});
