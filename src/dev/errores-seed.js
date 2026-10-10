// SOLO DESARROLLO: datos de prueba para ver Admin → Errores con la app completa.
//   GO_PREVIEW_SEED=errores-seed node node_modules/vite/bin/vite.js --config vite.preview.config.js --port 5181
// Abrir /#/admin/errores (entra como admin). No lee ni escribe la base real.
import { mockDb, Timestamp } from 'firebase/firestore';

const ADMIN = { uid: 'admin-demo', email: 'admin@demo.test', displayName: 'Admin de prueba' };
try { localStorage.setItem('gd-onboarding-done', 'true'); localStorage.setItem('gd-whats-new-seen', '999'); } catch (e) {}
window.__mockAuthUser = { ...ADMIN, getIdToken: async () => 'demo', emailVerified: true, providerData: [] };
mockDb.set(`users/${ADMIN.uid}`, { role: 'admin', isAdmin: true, displayName: ADMIN.displayName, email: ADMIN.email, onboardingCompleted: true });

const ago = (min) => Timestamp.fromMillis(Date.now() - min * 60000);
const sample = (over) => ({ route: '#/cart', platform: 'app android', version: '1791472600218', ua: 'Mozilla/5.0 (Linux; Android 14; SM-A145M) AppleWebKit/537.36 Chrome/129 Mobile Safari/537.36', userName: 'Gonzalo F.', role: 'user', at: new Date(), ...over });
const E = (id, d) => mockDb.set(`client_errors/${id}`, { fingerprint: id, status: 'open', network: false, ...d });

E('a1', {
  kind: 'error', message: "Cannot read properties of undefined (reading 'precio')", frame: 'at guardarCarrito (/assets/cart.js)',
  count: 47, userCount: 31, firstSeen: ago(60 * 26), lastSeen: ago(3),
  routes: { '#/cart': 44, '#/comercio/pizza': 3 }, roles: { user: 45, invitado: 2 }, versions: { '1791472600218': 47 }, platforms: { 'app android': 30, 'pwa ios': 17 },
  lastSample: sample({ stack: "TypeError: Cannot read properties of undefined (reading 'precio')\n    at guardarCarrito (https://godelivery-magdalena.web.app/assets/cart-Ab12cD34.js:120:18)\n    at HTMLButtonElement.onclick (https://godelivery-magdalena.web.app/assets/cart-Ab12cD34.js:900:3)" }),
});
E('a2', {
  kind: 'capturado', message: 'Error al actualizar FirebaseError: Missing or insufficient permissions. (permission-denied)', frame: 'at HTMLButtonElement.<anonymous> (/assets/delivery-panel.js)',
  count: 12, userCount: 4, firstSeen: ago(60 * 5), lastSeen: ago(42), reopenCount: 1,
  routes: { '#/delivery-panel': 12 }, roles: { delivery: 12 }, versions: { '1791472600218': 12 }, platforms: { 'app android': 12 },
  lastSample: sample({ route: '#/delivery-panel', role: 'delivery', userName: 'Cadete Martín', stack: 'FirebaseError: Missing or insufficient permissions.\n    at https://godelivery-magdalena.web.app/assets/delivery-panel-Zz98yY76.js:5713:9' }),
});
E('a3', {
  kind: 'promesa', message: 'TypeError: Failed to fetch', network: true, frame: '',
  count: 230, userCount: 88, firstSeen: ago(60 * 24 * 3), lastSeen: ago(1),
  routes: { '#/': 120, '#/delivery-panel': 110 }, roles: { user: 120, delivery: 110 }, versions: { '1791472600218': 230 }, platforms: { 'app android': 200, 'web pc': 30 },
  lastSample: sample({ route: '#/', stack: '' }),
});
E('a4', {
  kind: 'error', message: 'TypeError: map.getStyle is not a function', frame: 'at renderMultiStopRoute (/assets/driver-navigation-map.js)', status: 'resolved',
  statusBy: 'admin@demo.test', statusAt: ago(60 * 20),
  count: 9, userCount: 3, firstSeen: ago(60 * 48), lastSeen: ago(60 * 21),
  routes: { '#/delivery-panel': 9 }, roles: { delivery: 9 }, versions: { '1791300000000': 9 }, platforms: { 'app android': 9 },
  lastSample: sample({ route: '#/delivery-panel', role: 'delivery', stack: 'TypeError: map.getStyle is not a function\n    at renderMultiStopRoute (https://godelivery-magdalena.web.app/assets/driver-navigation-map-Q1w2E3r4.js:812:7)' }),
});

// Lo que agrega el vigilante (functions/vigilante.js): servidor, auditoría y su estado
E('srv1', {
  kind: 'servidor', message: "[Ledger] order <id> failed: TypeError: Cannot read properties of undefined (reading 'appUsageFee')", frame: 'onorderstatuschange',
  count: 14, userCount: 0, firstSeen: ago(60 * 3), lastSeen: ago(6), routes: { onorderstatuschange: 14 },
  lastSample: { service: 'onorderstatuschange', role: 'servidor', platform: 'Cloud Functions', stack: "[Ledger] order AbCdEf failed:\nTypeError: Cannot read properties of undefined (reading 'appUsageFee')\n    at applyCompletedOrder (/workspace/ledger.js:175:20)", at: new Date() },
});
E('audit_pedidos_trabados', {
  kind: 'auditoria', check: 'pedidos_trabados', severity: 'alta', message: 'Pedidos abiertos hace más de 3 horas (2)', affected: 2, count: 5,
  firstSeen: ago(75), lastSeen: ago(4), lastCheckedAt: ago(4),
  lastSample: { help: 'Un pedido que no se entregó ni se canceló en 3 horas casi siempre quedó colgado (cadete que no deslizó, estado que no avanzó).', items: [{ id: 'o1', label: '#8492 · Pizzería Los Sabores · delivering · Martín · hace 4 h' }, { id: 'o2', label: '#2210 · Mandado · accepted · Ana · hace 3 h' }] },
});
E('audit_cadetes_sin_push', {
  kind: 'auditoria', check: 'cadetes_sin_push', severity: 'media', message: 'Cadetes en línea que no pueden recibir notificaciones (1)', affected: 1, count: 30,
  firstSeen: ago(60 * 8), lastSeen: ago(4), lastCheckedAt: ago(4),
  lastSample: { help: 'No tienen ningún token de push: no les llegan las ofertas con la app cerrada.', items: [{ id: 'u1', label: 'Cadete Mudo · 2221000000' }] },
});
E('audit_puntos_negativos', {
  kind: 'auditoria', check: 'puntos_negativos', severity: 'alta', message: 'Clientes con GoPoints negativos (1)', affected: 0, count: 2, status: 'resolved', statusBy: 'vigilante', note: 'Se normalizó solo', statusAt: ago(30),
  firstSeen: ago(90), lastSeen: ago(45), lastCheckedAt: ago(4),
  lastSample: { help: 'Un canje que descontó dos veces o una devolución mal hecha.', items: [{ id: 'u2', label: 'Cliente Raro · -50 puntos' }] },
});
E('t1', {
  kind: 'toast', message: 'No se pudo confirmar tu pedido. Revisá "Mis pedidos" antes de volver a intentarlo.', frame: 'at HTMLButtonElement.<anonymous> (/assets/cart.js)',
  count: 6, userCount: 5, firstSeen: ago(60 * 6), lastSeen: ago(20), routes: { '#/cart': 6 }, roles: { user: 6 }, versions: { '1791472600218': 6 }, platforms: { 'app android': 6 },
  lastSample: sample({}),
});
const ok = (title, severity = 'alta') => ({ title, severity, ok: true, affected: 0, ms: 40 });
mockDb.set('system/vigilante', {
  lastRunAt: ago(4), lastRunMs: 1800, logs: { entries: 3, groups: 1, error: null, more: false },
  lastDailyAt: ago(60 * 5), dailyChecks: { libro_cadete_no_suma: ok('Cuenta de cadete cuya suma de movimientos no da el saldo') },
  checks: {
    pedidos_sin_cancelar: ok('Pedidos sin repartidor que no se cancelaron solos'),
    pedidos_trabados: { title: 'Pedidos abiertos hace más de 3 horas', severity: 'alta', ok: false, affected: 2, ms: 60 },
    ofertas_trabadas: ok('Ofertas a cadetes que no rotan'),
    totales_descuadrados: ok('Pedidos cuyo total no coincide con sus partes'),
    pedidos_sin_asiento: ok('Pedidos entregados que no se anotaron en la cuenta del cadete'),
    saldo_cadete_descuadrado: ok('Saldo de cadete distinto de su último movimiento'),
    rastreo_cortado: ok('Pedidos en camino sin ubicación del cadete hace más de 10 min', 'media'),
    cadetes_sin_push: { title: 'Cadetes en línea que no pueden recibir notificaciones', severity: 'media', ok: false, affected: 1, ms: 80 },
    cadete_desconectado_con_pedido: ok('Pedidos en curso con el cadete desconectado', 'media'),
    clima_sin_actualizar: ok('El chequeo de lluvia no se está actualizando', 'media'),
    reinicios_app: ok('Muchos reinicios de la app en las últimas 24 h', 'media'),
    puntos_negativos: ok('Clientes con GoPoints negativos'),
    cupones_pasados: ok('Cupones con usos restantes negativos', 'media'),
  },
});
