// Servidor de exploración: mantiene el navegador abierto y ejecuta snippets enviados por POST.
import http from 'node:http';
import { launch } from './browser.mjs';
const { ctx, page } = await launch();
page.on('console', m => { if (m.type() === 'error') console.log('[console]', m.text().slice(0, 200)); });
http.createServer(async (req, res) => {
  let body = ''; for await (const c of req) body += c;
  try {
    const fn = new Function('page', 'ctx', `return (async () => { ${body} })()`);
    const out = await fn(page, ctx);
    res.end(JSON.stringify(out ?? 'ok', null, 1));
  } catch (e) { res.end('ERROR: ' + e.message); }
}).listen(9333, () => console.log('listo en :9333'));
