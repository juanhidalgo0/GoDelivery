// Si Firestore se rompe por dentro, la app se recarga sola.
//
// El SDK de Firestore (12.x) tiene un error conocido: si se deja de escuchar una consulta y se la
// vuelve a escuchar mientras el servidor cambia esos documentos, a veces falla una verificación
// interna ("INTERNAL ASSERTION FAILED: Unexpected state (ID: ca9)"). Desde ese momento no llega
// ningún cambio más y toda escritura falla, hasta reiniciar la app: el repartidor marcaba
// "retirado", ponía el monto y no pasaba nada. En iPhone pasa algo parecido cuando el sistema corta
// la base local ("Connection to Indexed Database server lost").
// No hay forma de revivir ese cliente, así que se recarga la página (queda en la misma pantalla y
// todo vuelve a leerse de la base). Ver tests: se reproduce en el emulador cortando y reabriendo
// escuchas mientras cambian pedidos.

import { onLog } from 'firebase/app';
import { markReload } from './reload-log.js';

const FATAL = /INTERNAL (UNHANDLED ERROR|ASSERTION FAILED)|Indexed ?Database server lost/i;
const RELOAD_GUARD_KEY = 'gd_fs_recover_at';
const MIN_GAP_MS = 30000; // si vuelve a pasar enseguida no se entra en un bucle de recargas

let recovering = false;

function showReconnecting(withButton) {
  if (typeof document === 'undefined') return;
  document.getElementById('gd-fs-recover')?.remove();
  const el = document.createElement('div');
  el.id = 'gd-fs-recover';
  el.setAttribute('role', 'status');
  el.style.cssText = 'position:fixed; inset:0; z-index:2147483646; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:14px; background:rgba(11,11,12,0.88); color:#fff; font-family:var(--font-display, system-ui, sans-serif); text-align:center; padding:24px;';
  el.innerHTML = withButton
    ? `<div style="font-size:17px; font-weight:900;">Se cortó la conexión con GO!</div>
       <div style="font-size:13px; opacity:.8; max-width:280px;">Tocá para volver a cargar. Lo que ya guardaste no se pierde.</div>
       <button type="button" style="height:48px; padding:0 24px; border-radius:14px; border:none; background:#e11d48; color:#fff; font-weight:900; font-size:15px;">Volver a cargar</button>`
    : `<div style="width:44px; height:44px; border-radius:50%; border:4px solid rgba(255,255,255,.2); border-top-color:#e11d48; animation:gdFsSpin .8s linear infinite;"></div>
       <div style="font-size:16px; font-weight:900;">Reconectando…</div>
       <button type="button" style="margin-top:6px; background:none; border:none; color:#fff; opacity:.7; font-size:13px; font-weight:700; text-decoration:underline;">Volver a cargar ahora</button>
       <style>@keyframes gdFsSpin { to { transform: rotate(360deg); } }</style>`;
  el.querySelector('button')?.addEventListener('click', () => window.location.reload());
  (document.body || document.documentElement).appendChild(el);
}

/** Recarga la app porque el cliente de Firestore quedó inservible. */
export function recoverFromBrokenFirestore(reason = '') {
  if (recovering || typeof window === 'undefined') return;
  recovering = true;
  console.error('[Firestore] El cliente quedó inservible; se recarga la app.', String(reason).slice(0, 300));
  let last = 0;
  try { last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) || 0); } catch (e) { /* sin almacenamiento */ }
  if (Date.now() - last < MIN_GAP_MS) {
    // Recién se recargó por lo mismo: que decida la persona (evita un bucle de recargas)
    showReconnecting(true);
    return;
  }
  try { sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now())); } catch (e) { /* sin almacenamiento */ }
  showReconnecting(false);
  // El texto del error queda en Admin → Reinicios: sin él no se distingue ca9 de la base local cortada
  reloadWhenReachable(String(reason).replace(/\s+/g, ' ').slice(0, 140));
}

// La app nativa se carga desde el servidor: recargar sin señal la dejaría en una página de error.
// Se recarga recién cuando el servidor responde.
async function reloadWhenReachable(detail = '') {
  for (;;) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(`/version.json?_fs=${Date.now()}`, { cache: 'no-store', signal: ctrl.signal });
      clearTimeout(timer);
      if (res.ok) { markReload(`Firestore quedó inservible${detail ? ': ' + detail : ''}`); window.location.reload(); return; }
    } catch (e) { /* sin señal: se reintenta */ }
    await new Promise(res => setTimeout(res, 4000));
  }
}

const isFatal = (text) => FATAL.test(text) && /firestore/i.test(text);

/** Para los catch de la app: si el error es el de Firestore roto, recupera. Devuelve si lo era. */
export function recoverIfFirestoreBroken(err) {
  const text = String(err?.message || err || '');
  if (!isFatal(text)) return false;
  recoverFromBrokenFirestore(text);
  return true;
}

let watching = false;
export function watchFirestoreHealth() {
  if (watching || typeof window === 'undefined') return;
  watching = true;
  // El SDK avisa por su registro de errores ("INTERNAL UNHANDLED ERROR: ...") en el momento en que se rompe
  try {
    onLog(({ type, message }) => {
      const text = `${type || ''} ${message || ''}`;
      if (isFatal(text)) recoverFromBrokenFirestore(message);
    }, { level: 'error' });
  } catch (e) { /* entorno sin registro de Firebase */ }
  // Y cada operación posterior tira el mismo error
  window.addEventListener('error', (e) => {
    const text = String(e?.message || e?.error?.message || '');
    if (isFatal(text)) recoverFromBrokenFirestore(text);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const text = String(e?.reason?.message || e?.reason || '');
    if (isFatal(text)) recoverFromBrokenFirestore(text);
  });
}
