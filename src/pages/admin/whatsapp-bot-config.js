// Admin → Bot WhatsApp → Ajustes: vincular el número, gasto del mes contra el tope y cómo contesta el bot.
// Lo lee el servidor de wa_config/bot (functions/whatsapp/bot-config.js); el encendido, de settings/whatsapp_bot.
import { db, auth } from '../../firebase.js';
import { collection, doc, getDoc, getDocs, onSnapshot, setDoc } from 'firebase/firestore';
import { escapeHtml } from '../../utils/escape.js';
import { showToast } from '../../components/toast.js';
import { functionUrl } from '../../utils/functions-url.js';

const FREE_MONTHLY = 1000;
const META_APP_ID = '1440241144875106';
const DEFAULTS = {
  short: true,
  banner: false,
  greeting: '',
  askCompra: '🛒 *Contame todo en un solo mensaje:*\n• Qué querés y en qué comercio\n• Dirección de entrega\n• Efectivo o transferencia\n\n_Ej: 2 cocas de Paulos, calle 12 n° 345, efectivo_',
  askEnvio: '📦 *Contame todo en un solo mensaje:*\n• Qué hay que llevar\n• Retiro: de dónde\n• Entrega: adónde\n• Efectivo o transferencia\n\n_Ej: unas llaves, retiro: calle 9 n° 120, entrega: calle 20 n° 88, efectivo_',
  askComercio: '✍️ *Contame todo en un solo mensaje para {comercio}:*\n• Qué querés\n• Dirección de entrega\n• Efectivo o transferencia\n\n_Ej: una muzza grande, calle 12 n° 345, efectivo_',
  hiddenOptions: [],
  budgetArs: 100000,
  pricePerMessage: 37.68,
  metaConfigId: '',
};
const MENU_OPTIONS = [
  ['m_compra', '🛒 Comprar algo'],
  ['m_envio', '📦 Llevar o traer algo'],
  ['m_comercio', '🍔 Pedir a un comercio'],
  ['m_repeat', '🔁 Repetir mi pedido'],
  ['m_pedidos', '📋 Mis pedidos'],
  ['m_puntos', '🎁 Puntos y sorteos'],
  ['m_humano', '🙋 Hablar con alguien'],
];

const money = (n) => `$${Math.round(Number(n) || 0).toLocaleString('es-AR')}`;
const CARD = 'background:var(--color-surface); border:1.5px solid var(--color-border-light); border-radius:20px; padding:16px; display:flex; flex-direction:column; gap:12px;';
const TITLE = 'font-weight:900; font-size:15px; color:var(--color-text-primary);';
const HELP = 'font-size:12px; color:var(--color-text-secondary); line-height:1.45;';
const INPUT = 'width:100%; box-sizing:border-box; padding:10px 12px; border-radius:12px; border:1px solid var(--color-border); background:var(--color-bg); color:var(--color-text-primary); font-size:14px; font-family:inherit;';
const LABEL = 'font-size:12px; font-weight:800; color:var(--color-text-secondary); display:flex; flex-direction:column; gap:5px;';
const BTN = 'height:40px; padding:0 14px; border-radius:12px; border:none; background:#25D366; color:white; font-weight:850; font-size:13px; cursor:pointer;';
const BTN2 = 'height:40px; padding:0 14px; border-radius:12px; border:1px solid var(--color-border); background:var(--color-bg); color:var(--color-text-primary); font-weight:800; font-size:13px; cursor:pointer;';
const CHECK = 'display:flex; align-items:flex-start; gap:10px; font-size:13px; font-weight:700; color:var(--color-text-primary); cursor:pointer;';

const usageMonth = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 7);
const spentOf = (sent, price) => Math.max(0, (Number(sent) || 0) - FREE_MONTHLY) * price;

export async function renderBotConfig(container, isCurrent = () => true) {
  container.innerHTML = `<div style="text-align:center; padding:60px 20px; opacity:0.6;"><div class="spinner-mini" style="margin:0 auto 12px;"></div>Cargando ajustes…</div>`;
  let config, power, link, test;
  try {
    const [c, p, l, t] = await Promise.all([
      getDoc(doc(db, 'wa_config', 'bot')),
      getDoc(doc(db, 'settings', 'whatsapp_bot')),
      getDoc(doc(db, 'wa_config', 'link')),
      getDoc(doc(db, 'wa_config', 'test_mode')),
    ]);
    config = { ...DEFAULTS, ...(c.exists() ? c.data() : {}) };
    power = p.exists() ? p.data() : {};
    link = l.exists() ? l.data() : { connected: false };
    test = t.exists() ? t.data() : { enabled: false, numbers: [] };
  } catch (err) {
    console.error('Error cargando los ajustes del bot:', err);
    if (isCurrent()) container.innerHTML = `<div style="text-align:center; padding:40px; color:var(--color-error);">No se pudieron cargar los ajustes del bot</div>`;
    return () => {};
  }
  if (!isCurrent()) return () => {};

  container.innerHTML = `
    <div id="botcfg-alert"></div>

    <section style="${CARD}">
      <div style="${TITLE}">💸 Gasto del mes</div>
      <div id="botcfg-spend" style="font-size:26px; font-weight:900; color:var(--color-text-primary);">…</div>
      <div style="height:8px; border-radius:4px; background:var(--color-border-light); overflow:hidden;"><div id="botcfg-bar" style="height:100%; width:0%; background:#25D366; transition:width 0.3s;"></div></div>
      <div id="botcfg-detail" style="${HELP}"></div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
        <label style="${LABEL}">Tope por mes ($)<input id="botcfg-budget" type="number" min="0" step="1000" inputmode="numeric" value="${Number(config.budgetArs)}" style="${INPUT}"></label>
        <label style="${LABEL}">Precio por mensaje ($)<input id="botcfg-price" type="number" min="0" step="0.01" inputmode="decimal" value="${Number(config.pricePerMessage)}" style="${INPUT}"></label>
      </div>
      <div style="${HELP}">Es un cálculo de GO! con los mensajes enviados; la factura real la hace Meta. Si el precio de Meta cambia, actualizalo acá. Al llegar al tope el bot deja de contestar hasta que empiece el mes o lo subas, y te llega un aviso. También te avisa al 80%.</div>
      <div id="botcfg-history" style="${HELP}"></div>
    </section>

    <section style="${CARD}">
      <div style="${TITLE}">📱 Número vinculado</div>
      <div id="botcfg-link"></div>
      <div style="${HELP}"><strong>Al vincular se prende el modo prueba:</strong> el bot solo le contesta a los números de la lista de Ajustes → Economía, para que no le responda a todos tus clientes de golpe.</div>
      <div style="display:flex; flex-wrap:wrap; gap:8px;">
        <button id="botcfg-meta" style="${BTN}">Vincular con Meta (QR)</button>
        <button id="botcfg-check" style="${BTN2}">Comprobar conexión</button>
        <button id="botcfg-unlink" style="${BTN2} color:var(--color-error);">Desvincular</button>
      </div>
      <label style="${LABEL}">Id de configuración del registro de Meta<input id="botcfg-metaconfig" value="${escapeHtml(config.metaConfigId || '')}" placeholder="Lo da Meta en Facebook Login para empresas" style="${INPUT}"></label>
      <div style="${HELP}">El QR se hace desde una computadora, con el celular que tiene WhatsApp Business en la mano.</div>
      <details>
        <summary style="font-size:13px; font-weight:800; cursor:pointer; color:var(--color-text-primary);">Vincular a mano con un token</summary>
        <div style="display:flex; flex-direction:column; gap:10px; margin-top:10px;">
          <label style="${LABEL}">Id del número<input id="botcfg-phoneid" inputmode="numeric" autocomplete="off" style="${INPUT}"></label>
          <label style="${LABEL}">Id de la cuenta de WhatsApp (WABA)<input id="botcfg-waba" inputmode="numeric" autocomplete="off" style="${INPUT}"></label>
          <label style="${LABEL}">Token permanente<input id="botcfg-token" type="password" autocomplete="off" style="${INPUT}"></label>
          <button id="botcfg-manual" style="${BTN2}">Vincular con estos datos</button>
        </div>
      </details>
    </section>

    <section style="${CARD}">
      <div style="${TITLE}">🤖 Cómo contesta el bot</div>
      <label style="${CHECK}"><input id="botcfg-enabled" type="checkbox" ${power.enabled !== false ? 'checked' : ''}><span>Bot prendido<br><span style="${HELP} font-weight:500;">Apagado no contesta nada y no gasta.</span></span></label>
      <label style="${CHECK}"><input id="botcfg-test" type="checkbox" ${test.enabled === true ? 'checked' : ''}><span>Modo prueba<br><span style="${HELP} font-weight:500;">Solo contesta a ${(test.numbers || []).length} número${(test.numbers || []).length === 1 ? '' : 's'} de la lista. Apagalo cuando quieras que atienda a todos.</span></span></label>
      <label style="${CHECK}"><input id="botcfg-short" type="checkbox" ${config.short ? 'checked' : ''}><span>Camino corto<br><span style="${HELP} font-weight:500;">Pide todo en un solo mensaje. Gasta cerca de la mitad.</span></span></label>
      <label style="${CHECK}"><input id="botcfg-banner" type="checkbox" ${config.banner ? 'checked' : ''}><span>Imagen en el primer saludo del día<br><span style="${HELP} font-weight:500;">Suma un mensaje por cliente por día.</span></span></label>
      <label style="${LABEL}">Saludo del menú ({nombre} es el nombre del cliente)<input id="botcfg-greeting" value="${escapeHtml(config.greeting || '')}" placeholder="¡Hola {nombre}! 👋 ¿Qué necesitás hoy?" style="${INPUT}"></label>
      <label style="${LABEL}">Mensaje al comprar algo<textarea id="botcfg-askcompra" rows="6" style="${INPUT}">${escapeHtml(config.askCompra)}</textarea></label>
      <label style="${LABEL}">Mensaje al llevar o traer algo<textarea id="botcfg-askenvio" rows="6" style="${INPUT}">${escapeHtml(config.askEnvio)}</textarea></label>
      <label style="${LABEL}">Mensaje al pedir a un comercio ({comercio} es su nombre)<textarea id="botcfg-askcomercio" rows="6" style="${INPUT}">${escapeHtml(config.askComercio)}</textarea></label>
      <div style="${LABEL}">Opciones del menú
        ${MENU_OPTIONS.map(([id, label]) => `<label style="${CHECK} font-weight:600;"><input class="botcfg-option" data-id="${id}" type="checkbox" ${(config.hiddenOptions || []).includes(id) ? '' : 'checked'}><span>${label}</span></label>`).join('')}
      </div>
    </section>

    <button id="botcfg-save" style="${BTN} height:48px; font-size:15px; flex-shrink:0;">Guardar cambios</button>
  `;

  const $ = (id) => container.querySelector(`#botcfg-${id}`);
  let sent = 0;

  function paintUsage() {
    const budget = Math.max(0, Number($('budget').value) || 0);
    const price = Math.max(0, Number($('price').value) || 0);
    const spent = spentOf(sent, price);
    const capped = sent >= FREE_MONTHLY && spent >= budget;
    $('spend').textContent = `${money(spent)} de ${money(budget)}`;
    $('bar').style.width = `${budget ? Math.min(100, (spent / budget) * 100) : (capped ? 100 : 0)}%`;
    $('bar').style.background = capped ? 'var(--color-error)' : (budget && spent >= budget * 0.8 ? '#f59e0b' : '#25D366');
    const freeLeft = Math.max(0, FREE_MONTHLY - sent);
    const paidLeft = price > 0 ? Math.max(0, Math.floor((budget - spent) / price)) : 0;
    const day = new Date(Date.now() - 3 * 3600 * 1000).getUTCDate();
    const [y, m] = usageMonth().split('-').map(Number);
    const projected = spentOf((sent / day) * new Date(Date.UTC(y, m, 0)).getUTCDate(), price);
    $('detail').textContent = `${sent.toLocaleString('es-AR')} mensajes este mes. ${freeLeft ? `Quedan ${freeLeft.toLocaleString('es-AR')} gratis. ` : ''}Antes del tope quedan ${(freeLeft + paidLeft).toLocaleString('es-AR')} mensajes. A este ritmo cerraría el mes en ${money(projected)}.`;
    $('alert').innerHTML = capped
      ? `<div style="background:rgba(239,68,68,0.12); border:1.5px solid var(--color-error); border-radius:16px; padding:12px 14px; font-size:13px; font-weight:700; color:var(--color-text-primary);">🛑 El bot está pausado porque llegó al tope. Contestá a los clientes desde el celular; las respuestas de Humano / Soporte tampoco salen hasta que subas el tope.</div>`
      : '';
  }

  function paintLink() {
    $('link').innerHTML = link.connected
      ? `<div style="font-size:14px; font-weight:800; color:var(--color-text-primary);">✅ ${escapeHtml(link.display || link.phoneNumberId || 'Conectado')}${link.name ? ` · ${escapeHtml(link.name)}` : ''}</div>
         <div style="${HELP}">${link.coexistence ? 'Comparte el número con WhatsApp Business. ' : ''}${link.quality ? `Calidad según Meta: ${escapeHtml(link.quality)}.` : ''}</div>`
      : `<div style="font-size:14px; font-weight:800; color:var(--color-text-secondary);">Sin número vinculado desde acá</div>`;
    $('unlink').style.display = link.connected ? '' : 'none';
  }

  const unsubUsage = onSnapshot(doc(db, 'wa_usage', usageMonth()), (snap) => {
    sent = snap.exists() ? Number(snap.data().sent) || 0 : 0;
    paintUsage();
  }, () => {});
  ['budget', 'price'].forEach((id) => { $(id).oninput = paintUsage; });
  paintLink();

  getDocs(collection(db, 'wa_usage')).then((snap) => {
    const price = Number(config.pricePerMessage) || 0;
    const past = snap.docs.filter((d) => d.id !== usageMonth()).sort((a, b) => b.id.localeCompare(a.id)).slice(0, 6);
    if (past.length) $('history').innerHTML = `<strong>Meses anteriores (estimado):</strong> ${past.map((d) => `${escapeHtml(d.id)}: ${money(spentOf(d.data().sent, price))}`).join(' · ')}`;
  }).catch(() => {});

  async function callLink(body) {
    const idToken = await auth.currentUser.getIdToken();
    const res = await fetch(functionUrl('waBotLink'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken, ...body }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'No se pudo completar');
    return data;
  }

  async function linkAction(button, body, okText) {
    button.disabled = true;
    try {
      link = await callLink(body);
      paintLink();
      if (link.connected && body.action === 'connect') {
        $('test').checked = true;
        $('token').value = '';
      }
      showToast(okText, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      button.disabled = false;
    }
  }

  $('check').onclick = () => linkAction($('check'), { action: 'status' }, 'Conexión comprobada');
  $('unlink').onclick = () => {
    if (window.confirm('¿Desvincular este número? El bot deja de atenderlo.')) linkAction($('unlink'), { action: 'disconnect' }, 'Número desvinculado');
  };
  $('manual').onclick = () => {
    linkAction($('manual'), { action: 'connect', token: $('token').value, phoneNumberId: $('phoneid').value.trim(), wabaId: $('waba').value.trim() }, 'Número vinculado, con el modo prueba prendido');
  };
  $('meta').onclick = () => {
    const configId = $('metaconfig').value.trim();
    if (!configId) { showToast('Falta el id de configuración del registro de Meta', 'warning'); return; }
    startMetaSignup(configId, (result) => linkAction($('meta'), { action: 'connect', ...result }, 'Número vinculado, con el modo prueba prendido'));
  };

  $('save').onclick = async () => {
    const budget = Number($('budget').value);
    const price = Number($('price').value);
    if (!Number.isFinite(budget) || budget < 0 || !Number.isFinite(price) || price < 0) { showToast('Revisá el tope y el precio', 'warning'); return; }
    const button = $('save');
    button.disabled = true;
    try {
      await Promise.all([
        setDoc(doc(db, 'wa_config', 'bot'), {
          budgetArs: budget,
          pricePerMessage: price,
          short: $('short').checked,
          banner: $('banner').checked,
          greeting: $('greeting').value.trim(),
          askCompra: $('askcompra').value.trim() || DEFAULTS.askCompra,
          askEnvio: $('askenvio').value.trim() || DEFAULTS.askEnvio,
          askComercio: $('askcomercio').value.trim() || DEFAULTS.askComercio,
          metaConfigId: $('metaconfig').value.trim(),
          hiddenOptions: [...container.querySelectorAll('.botcfg-option')].filter((c) => !c.checked).map((c) => c.dataset.id),
        }, { merge: true }),
        setDoc(doc(db, 'settings', 'whatsapp_bot'), { enabled: $('enabled').checked }, { merge: true }),
        setDoc(doc(db, 'wa_config', 'test_mode'), { enabled: $('test').checked }, { merge: true }),
      ]);
      showToast('Guardado. El bot lo toma en hasta un minuto', 'success');
    } catch (err) {
      console.error('Error guardando los ajustes del bot:', err);
      showToast('No se pudo guardar', 'error');
    } finally {
      button.disabled = false;
    }
  };

  return unsubUsage;
}

// Registro de Meta para un número que ya usa WhatsApp Business (coexistencia): abre la ventana de Meta
// y devuelve el código más los ids que manda por postMessage.
function startMetaSignup(configId, onDone) {
  if (window.Capacitor?.isNativePlatform?.()) {
    showToast('El QR se hace desde una computadora', 'warning');
    return;
  }
  const session = {};
  const onMessage = (event) => {
    if (!/(^|\.)facebook\.com$/.test(new URL(event.origin).hostname)) return;
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'WA_EMBEDDED_SIGNUP' && data.data?.phone_number_id) {
        session.phoneNumberId = data.data.phone_number_id;
        session.wabaId = data.data.waba_id;
      }
    } catch (e) { /* otros mensajes de Meta, no son JSON */ }
  };
  window.addEventListener('message', onMessage);

  const open = () => {
    window.FB.init({ appId: META_APP_ID, autoLogAppEvents: false, xfbml: false, version: 'v23.0' });
    window.FB.login((response) => {
      window.removeEventListener('message', onMessage);
      const code = response.authResponse?.code;
      if (!code) { showToast('Se canceló la vinculación', 'warning'); return; }
      if (!session.phoneNumberId) { showToast('Meta no devolvió el número. Probá de nuevo', 'error'); return; }
      onDone({ code, ...session });
    }, {
      config_id: configId,
      response_type: 'code',
      override_default_response_type: true,
      extras: { setup: {}, featureType: 'whatsapp_business_app_onboarding', sessionInfoVersion: '3' },
    });
  };
  if (window.FB) { open(); return; }
  const script = document.createElement('script');
  script.src = 'https://connect.facebook.net/es_LA/sdk.js';
  script.async = true;
  script.onload = open;
  script.onerror = () => {
    window.removeEventListener('message', onMessage);
    showToast('No se pudo abrir el registro de Meta', 'error');
  };
  document.head.appendChild(script);
}
