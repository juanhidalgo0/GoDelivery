// Entrada al panel del comercio desde la caja Ventra: #/ventra/{código}.
// Ventra pide al puente un código de un solo uso (functions/ventra-bridge.js, panelLink) y abre
// esta página; acá se cambia por la sesión de la cuenta de la caja, que solo tiene acceso a su
// comercio, y se entra a "Mi local" (logo, portada, datos, horarios y el resto del panel).
import { auth } from '../firebase.js';
import { signInWithCustomToken } from 'firebase/auth';
import { getState } from '../state.js';
import { functionUrl } from '../utils/functions-url.js';
import { escapeHtml as esc } from '../utils/escape.js';

// s=panel: el inicio del panel; las demás, la sección con ese nombre
const SECTIONS = new Set(['panel', 'settings', 'products', 'orders', 'promos', 'metrics', 'categorias', 'finances']);

function paint(container, title, text = '', spinner = false) {
  container.innerHTML = `
    <div style="min-height:70vh; display:flex; align-items:center; justify-content:center; padding:24px;">
      <div style="max-width:380px; width:100%; text-align:center; display:flex; flex-direction:column; gap:12px; align-items:center;">
        ${spinner ? '<div style="width:34px; height:34px; border-radius:50%; border:3px solid var(--color-border); border-top-color:var(--color-primary); animation:spin 0.8s linear infinite;"></div>' : ''}
        <h2 style="font-family:var(--font-display); font-size:20px; font-weight:900; margin:0; color:var(--color-text-primary);">${esc(title)}</h2>
        ${text ? `<p style="margin:0; font-size:14px; line-height:1.5; color:var(--color-text-secondary);">${esc(text)}</p>` : ''}
      </div>
    </div>`;
}

export async function renderVentraPanel(container) {
  const m = window.location.hash.match(/#\/ventra\/([A-Za-z0-9_-]+)(?:\?s=([a-z]+))?/);
  const code = m ? m[1] : '';
  const section = m && SECTIONS.has(m[2]) ? m[2] : 'settings';
  paint(container, 'Entrando a tu comercio…', 'Un momento: abrimos el panel de tu tienda en GO.', true);
  try {
    const res = await fetch(functionUrl('ventraBridge'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'panelLogin', code }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'No se pudo entrar');
    const cred = await signInWithCustomToken(auth, data.token);
    // Espera a que la app cargue el perfil de la cuenta de la caja (initAuth) antes de entrar
    const end = Date.now() + 8000;
    while (getState().user?.uid !== cred.user.uid && Date.now() < end) await new Promise((r) => setTimeout(r, 150));
    window.location.replace(`#/mi-comercio/${encodeURIComponent(data.comercioId)}${section === 'panel' ? '' : `/${section}`}`);
  } catch (err) {
    paint(container, 'No pudimos abrir tu comercio', err?.message || 'Probá de nuevo desde Ventra.');
  }
}
