// Sends order-creation requests (createOrder / createFavorOrder) safely.
//
// The server replays the stored result for a repeated clientRequestId (see
// withOrderIdempotency in functions/index.js). Here we keep that id stable for as long as the
// customer is retrying the SAME order, so a dropped connection followed by "Intentar de nuevo"
// returns the order that was already created instead of creating a second one.

const STORAGE_KEY = 'gd_pending_order_requests';
const REQUEST_TTL_MS = 15 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 30 * 1000;

function readPending() {
  try {
    const all = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '{}');
    const now = Date.now();
    return Object.fromEntries(Object.entries(all).filter(([, v]) => v && now - v.at < REQUEST_TTL_MS));
  } catch (e) {
    return {};
  }
}

function writePending(all) {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(all)); } catch (e) {}
}

// Identifies "the same order" across retries. bundleId is regenerated on every tap, so it
// must not make two attempts of one checkout look different.
function fingerprint(url, body) {
  const { bundleId, ...stable } = body || {};
  const text = url + JSON.stringify(stable);
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  return String(hash);
}

function newRequestId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID().replace(/-/g, '');
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

function requestIdFor(key) {
  const all = readPending();
  if (!all[key]) {
    all[key] = { id: newRequestId(), at: Date.now() };
    writePending(all);
  }
  return all[key].id;
}

function forgetRequest(key) {
  const all = readPending();
  delete all[key];
  writePending(all);
}

const wait = (ms) => new Promise(r => setTimeout(r, ms));

export class OrderRequestError extends Error {
  constructor(message, { isConnection = false } = {}) {
    super(message);
    this.isConnection = isConnection;
  }
}

async function postOnce(url, body, idToken) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
    // A timeout page or a proxy error is not JSON; don't let "Unexpected token <" reach the user.
    let data = null;
    try { data = await response.json(); } catch (e) {}
    return { status: response.status, ok: response.ok, data };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * POSTs an order and returns the server's JSON. Throws OrderRequestError with a message fit
 * for the customer. Network failures are retried automatically with the same request id,
 * which is safe because the server deduplicates it.
 */
export async function postOrderRequest(url, body, getIdToken) {
  const key = fingerprint(url, body);
  const payload = { ...body, clientRequestId: requestIdFor(key) };

  let lastConnectionError = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    let result;
    try {
      result = await postOnce(url, payload, await getIdToken());
    } catch (err) {
      // Timeout or no connection: the order may or may not exist. Retry with the same id.
      lastConnectionError = err;
      if (attempt < 2) { await wait(1500 * (attempt + 1)); continue; }
      throw new OrderRequestError('No pudimos confirmar tu pedido por un problema de conexión. Revisá tu internet y tocá "Intentar de nuevo": no se va a duplicar.', { isConnection: true });
    }

    if (result.ok) {
      forgetRequest(key);
      return result.data || {};
    }
    if (result.status === 409 && result.data?.inProgress) {
      // The first attempt is still being processed on the server: wait for its result.
      await wait(2000);
      continue;
    }
    if (result.status >= 500 && !result.data?.error) {
      lastConnectionError = new Error(`HTTP ${result.status}`);
      if (attempt < 2) { await wait(1500 * (attempt + 1)); continue; }
    }
    // A real rejection (no stock, coupon, closed commerce...): a retry must start fresh.
    forgetRequest(key);
    throw new OrderRequestError(result.data?.error || 'No pudimos procesar tu pedido. Probá de nuevo en unos segundos.');
  }

  throw new OrderRequestError('Tu pedido está tardando más de lo normal. Revisá "Mis pedidos" antes de volver a intentarlo.', { isConnection: Boolean(lastConnectionError) });
}
