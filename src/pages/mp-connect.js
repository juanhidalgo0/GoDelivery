// GoDelivery — Mercado Pago OAuth Handler
import { getRouteParams, navigate } from '../router.js';
import { db } from '../firebase.js';
import { showToast } from '../components/toast.js';
import { icon } from '../utils/icons.js';

export async function renderMPConnect() {
  const content = document.getElementById('app-content');
  
  // Extract params from hash URL (mp sends them as query params after the #)
  const hash = window.location.hash;
  const urlParams = new URLSearchParams(hash.split('?')[1]);
  const code = urlParams.get('code');
  const comercioId = urlParams.get('state');

  content.innerHTML = `
    <div class="panel-page page-enter" style="display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:80vh; text-align:center;">
      <div class="loader-mp" style="width:60px; height:60px; border:4px solid #f3f3f3; border-top:4px solid #009ee3; border-radius:50%; animation: spin 1s linear infinite; margin-bottom:var(--space-4);"></div>
      <h2 style="font-size:var(--font-lg); margin-bottom:var(--space-2);">Vinculando con Mercado Pago...</h2>
      <p style="color:var(--color-text-secondary); font-size:var(--font-sm);">Por favor no cierres esta ventana.</p>
      
      <style>
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
      </style>
    </div>
  `;

  if (!code || !comercioId) {
    showToast('Error: No se recibió el código de autorización', 'error');
    navigate(`/mi-comercio/${comercioId}/settings`);
    return;
  }

  try {
    const response = await fetch(`https://us-central1-godelivery-magdalena.cloudfunctions.net/mercadopagoConnect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, comercioId })
    });

    const data = await response.json();

    if (data.success) {
      content.innerHTML = `
        <div class="panel-page page-enter" style="display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:80vh; text-align:center;">
          <div style="color:var(--color-success); margin-bottom:var(--space-4);">${icon('check-circle', 64)}</div>
          <h2 style="font-size:var(--font-lg); margin-bottom:var(--space-2);">¡Cuenta Vinculada!</h2>
          <p style="color:var(--color-text-secondary); font-size:var(--font-sm); margin-bottom:var(--space-6);">Ya podés recibir cobros automáticos en tu comercio.</p>
          <a href="#/mi-comercio/${comercioId}/settings" class="btn btn-primary">Volver a Configuración</a>
        </div>
      `;
      showToast('¡Mercado Pago vinculado con éxito!', 'success');
    } else {
      throw new Error(data.error || 'Error en la vinculación');
    }

  } catch (error) {
    console.error('MP Connect Error:', error);
    content.innerHTML = `
      <div class="panel-page page-enter" style="display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:80vh; text-align:center;">
        <div style="color:var(--color-danger); margin-bottom:var(--space-4);">${icon('warning', 64)}</div>
        <h2 style="font-size:var(--font-lg); margin-bottom:var(--space-2);">Error de Vinculación</h2>
        <p style="color:var(--color-text-secondary); font-size:var(--font-sm); margin-bottom:var(--space-6);">${error.message}</p>
        <a href="#/mi-comercio/${comercioId}/settings" class="btn btn-primary">Reintentar</a>
      </div>
    `;
    showToast('No se pudo vincular la cuenta', 'error');
  }
}
