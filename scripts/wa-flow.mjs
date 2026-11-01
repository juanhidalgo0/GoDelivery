// Formulario nativo de WhatsApp (WhatsApp Flows) del bot: functions/whatsapp/flows/pedido.json.
//
//   node scripts/wa-flow.mjs create <WABA_ID>   crea el borrador y muestra su id (→ WHATSAPP_FLOW_ID)
//   node scripts/wa-flow.mjs update             sube de nuevo el JSON al borrador
//   node scripts/wa-flow.mjs preview            link de vista previa (se abre en el navegador)
//   node scripts/wa-flow.mjs publish            lo publica: después ya no se puede editar, solo clonar
//
// Publicar exige el negocio verificado en Meta (si no: error 139000 "Integrity requirements not met").
// Hasta entonces, con WHATSAPP_FLOW_MODE=draft el bot lo manda como borrador, que sirve para probar.
// Lee WHATSAPP_TOKEN y WHATSAPP_FLOW_ID de functions/.env. Al pasar al número de GO! (otra cuenta de
// WhatsApp), hay que crearlo y publicarlo de nuevo allá y cambiar WHATSAPP_FLOW_ID.
// El formulario no usa servidor propio (sin endpoint): los datos van en el mensaje y la respuesta
// llega al webhook como nfm_reply (functions/whatsapp/index.js).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FLOW_FILE = path.join(ROOT, 'functions', 'whatsapp', 'flows', 'pedido.json');
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, 'functions', '.env'), 'utf8')
  .split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const VERSION = env.WHATSAPP_API_VERSION || 'v23.0';
const token = env.WHATSAPP_TOKEN;
if (!token) { console.error('Falta WHATSAPP_TOKEN en functions/.env'); process.exit(1); }

async function graph(method, p, body) {
  const res = await fetch(`https://graph.facebook.com/${VERSION}/${p}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}),
  });
  const json = await res.json();
  if (!res.ok) { console.error(JSON.stringify(json, null, 2)); process.exitCode = 1; throw new Error('Meta rechazó el pedido'); }
  return json;
}

// El encabezado (flows/header.jpg, scripts/make-wa-flow-header.py) va adentro del JSON como base64
const HEADER_FILE = path.join(ROOT, 'functions', 'whatsapp', 'flows', 'header.jpg');
const flowJson = () => JSON.stringify(JSON.parse(fs.readFileSync(FLOW_FILE, 'utf8')
  .replace('__GO_HEADER__', fs.readFileSync(HEADER_FILE).toString('base64'))));
const flowId = () => {
  if (!env.WHATSAPP_FLOW_ID) { console.error('Falta WHATSAPP_FLOW_ID en functions/.env'); process.exit(1); }
  return env.WHATSAPP_FLOW_ID;
};
const showErrors = (r) => {
  const errs = r.validation_errors || [];
  if (errs.length) { console.log('Errores de validación:'); errs.forEach((e) => console.log(' -', e.error, e.message || '', e.line_start ? `(línea ${e.line_start})` : '')); }
  return errs.length;
};

const [cmd, arg] = process.argv.slice(2);
if (cmd === 'create') {
  if (!arg) { console.error('Uso: create <WABA_ID>'); process.exit(1); }
  const r = await graph('POST', `${arg}/flows`, { name: 'GO! Pedido: entrega y pago', categories: ['OTHER'], flow_json: flowJson() });
  console.log(`Borrador creado: ${r.id}\nAgregá WHATSAPP_FLOW_ID=${r.id} a functions/.env`);
  showErrors(r);
} else if (cmd === 'update') {
  const form = new FormData();
  form.append('file', new Blob([flowJson()], { type: 'application/json' }), 'flow.json');
  form.append('name', 'flow.json');
  form.append('asset_type', 'FLOW_JSON');
  const r = await graph('POST', `${flowId()}/assets`, form);
  if (!showErrors(r)) console.log('Borrador actualizado, sin errores.');
} else if (cmd === 'preview') {
  const r = await graph('GET', `${flowId()}?fields=name,status,validation_errors,preview.invalidate(true)`);
  console.log(`${r.name} · ${r.status}`);
  showErrors(r);
  console.log(r.preview && r.preview.preview_url);
} else if (cmd === 'publish') {
  await graph('POST', `${flowId()}/publish`);
  const r = await graph('GET', `${flowId()}?fields=name,status`);
  console.log(`${r.name} · ${r.status}`);
} else {
  console.log('Uso: node scripts/wa-flow.mjs create <WABA_ID> | update | preview | publish');
}
