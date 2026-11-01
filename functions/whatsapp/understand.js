// Entender un pedido de compras escrito (o dicho) de corrido:
//   "una coca de paulos, dos manzanas del lucianito y 1kg de carne de san javier"
//   → [{ store: "Kiosco Paulos", items: "una coca" }, { store: "El Lucianito", ... }, ...]
//
// La IA se usa solo si hace falta, en este orden:
//   1. Reglas (gratis): "<qué> de/del/en <comercio>", con los comercios que GO! conoce
//      (comercios + mandadoPlaces) para reconocer "paulos" → "Kiosco Paulos".
//   2. Si las reglas no alcanzan: Claude Haiku 5.5 (ANTHROPIC_API_KEY en functions/.env).
//   3. Audios: Google Speech-to-Text los pasa a texto y vuelven al paso 1.
//   Fotos de una lista: solo Haiku las puede leer.
// Cada cliente tiene un tope diario de llamadas a la IA (AI_DAILY_LIMIT) y todo queda en wa_ai_log.
const logger = require("firebase-functions/logger");
const { FieldValue } = require("firebase-admin/firestore");

const MODEL_DEFAULT = "claude-haiku-5-5";
const AI_DAILY_LIMIT = 15;
const MAX_STOPS = 5;

const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9ñ]+/g, " ").replace(/\s+/g, " ").trim();
const STOP_WORDS = new Set(["el", "la", "los", "las", "lo", "de", "del", "kiosco", "kiosko", "almacen", "super", "supermercado", "despensa", "verduleria", "carniceria", "panaderia", "farmacia", "rotiseria", "fiambreria", "drugstore", "maxikiosco", "polleria", "libreria"]);
const keyWords = (s) => norm(s).split(" ").filter((w) => w && !STOP_WORDS.has(w));

// Lo que no puede ser un comercio aunque venga después de un "de": "1 kg de papa", "pan de campo"
const NOT_A_STORE = /^(papa|papas|carne|pollo|pan|leche|queso|jamon|agua|coca|cerveza|vino|azucar|harina|arroz|fideos|aceite|yerba|cafe|te|tomate|cebolla|lechuga|manzana|manzanas|banana|bananas|naranja|naranjas|huevo|huevos|campo|molde|chocolate|dulce|frutilla|vainilla|cerdo|vaca|pescado|soja|maiz|trigo|limon|ajo|zanahoria|zapallo|mortadela|salame|picada|asado|vacio|nalga|peceto|milanesa|milanesas|carton|botella|litro|litros|kilo|kilos|gramos|paquete|caja|lata)$/;

function createUnderstand({ db }) {
  let known = { at: 0, list: [] };

  // Comercios conocidos: los de GO! y los que aprendió el panel de los cadetes (mandadoPlaces)
  async function knownStores() {
    if (Date.now() - known.at < 10 * 60 * 1000) return known.list;
    const [com, learned] = await Promise.all([
      db.collection("comercios").get().catch(() => null),
      db.collection("mandadoPlaces").get().catch(() => null),
    ]);
    const list = [];
    if (com) com.docs.forEach((d) => { const c = d.data(); if (c.isActive !== false && c.name) list.push(c.name); });
    if (learned) learned.docs.forEach((d) => { const x = d.data(); if (x.hidden !== true && x.name) list.push(x.name); });
    known = { at: Date.now(), list: [...new Set(list)] };
    return known.list;
  }

  // "paulos" → "Kiosco Paulos": todas las palabras importantes de lo escrito están en el nombre conocido
  function matchKnown(raw, list) {
    const want = keyWords(raw);
    if (!want.length) return null;
    let best = null;
    for (const name of list) {
      const have = keyWords(name);
      if (!have.length) continue;
      const hits = want.filter((w) => have.some((h) => h === w || (w.length >= 5 && (h.startsWith(w) || w.startsWith(h)))));
      if (hits.length === want.length) {
        const score = hits.length / have.length;
        if (!best || score > best.score) best = { name, score };
      }
    }
    // Si lo escrito es una parte chica del nombre ("pepe" de "Pizzería Don Pepe"), no se asume que es ese
    return best && best.score >= 0.5 ? best.name : null;
  }

  const looksLikeStoreName = (text) => {
    const t = String(text || "").trim();
    return t.length >= 2 && t.length <= 60 && !/[,;\n]/.test(t) && !/\d/.test(t) && t.split(/\s+/).length <= 6 && !/\s(de|del|en)\s/i.test(` ${t} `.slice(1));
  };

  // 1. Reglas. Devuelve { stops, complete } — complete: cada parte del texto quedó en un comercio.
  async function byRules(text) {
    const list = await knownStores();
    const parts = String(text || "")
      .replace(/\s+y\s+(?=(un|una|unos|unas|dos|tres|cuatro|cinco|medio|media|\d))/gi, ", ")
      .split(/[\n;,]+|\s+\+\s+/).map((p) => p.trim()).filter(Boolean);
    if (!parts.length) return { stops: [], complete: false };
    const stops = [];
    let pending = []; // cosas sin comercio: se suman al comercio que viene después ("pan y leche de paulos")
    let assigned = 0;
    for (const part of parts) {
      // Qué comprar / dónde: primero "de lo de X", después "en X" (el primero: "en el kiosco de la
      // esquina"), y si no, el último "de": "1kg de carne de san javier"
      const m = part.match(/^(.*\S)\s+(de lo de|en lo de)\s+(.+)$/i)
        || part.match(/^(.*?\S)\s+(en)\s+(.+)$/i)
        || part.match(/^(.*\S)\s+(de la|del|de)\s+(.+)$/i);
      let store = null, items = part;
      if (m) {
        const said = m[3].replace(/[.!?]+$/, "").trim();
        const sep = m[2].toLowerCase();
        const candidate = sep === "de la" && !/^las/i.test(said) ? `La ${said}` : (sep.endsWith("lo de") ? `lo de ${said}` : said);
        const hit = matchKnown(candidate, list);
        // "en X" y "de lo de X" siempre son un lugar; con "de" solo si es conocido o está en mayúscula
        const strong = ["de lo de", "en lo de", "en"].includes(m[2].toLowerCase());
        const capitalized = /^[A-ZÁÉÍÓÚÑ]/.test(candidate);
        if (hit) store = hit;
        else if (!NOT_A_STORE.test(norm(candidate)) && (strong || capitalized)) store = candidate;
        if (store) items = m[1].trim();
      }
      if (!store) { pending.push(part); continue; }
      const key = norm(store);
      let st = stops.find((s) => norm(s.store) === key);
      if (!st) { st = { store, items: "" }; stops.push(st); }
      st.items = [st.items, ...pending, items].filter(Boolean).join(", ");
      assigned += pending.length + 1;
      pending = [];
    }
    return { stops: stops.slice(0, MAX_STOPS), complete: stops.length > 0 && pending.length === 0 && assigned === parts.length };
  }

  // ── IA ──
  let client = null;
  function anthropic() {
    if (!process.env.ANTHROPIC_API_KEY) return null;
    if (!client) {
      const m = require("@anthropic-ai/sdk");
      const Anthropic = m.default || m.Anthropic || m;
      client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 25000 });
    }
    return client;
  }

  async function aiAllowed(waId) {
    const cfg = await db.collection("wa_config").doc("ai").get().catch(() => null);
    const c = cfg && cfg.exists ? cfg.data() : {};
    if (c.enabled === false || !anthropic()) return null;
    const day = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10); // día de Argentina
    const ref = db.collection("wa_sessions").doc(waId);
    const ok = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const s = snap.exists ? snap.data() : {};
      const used = s.aiDay === day ? (s.aiCount || 0) : 0;
      if (used >= (Number(c.dailyLimit) || AI_DAILY_LIMIT)) return false;
      tx.set(ref, { aiDay: day, aiCount: used + 1 }, { merge: true });
      return true;
    }).catch(() => false);
    return ok ? { model: c.model || MODEL_DEFAULT } : null;
  }

  const SCHEMA = {
    type: "object",
    properties: {
      is_order: { type: "boolean" },
      stops: {
        type: "array",
        items: {
          type: "object",
          properties: { store: { type: "string" }, items: { type: "string" } },
          required: ["store", "items"],
          additionalProperties: false,
        },
      },
    },
    required: ["is_order", "stops"],
    additionalProperties: false,
  };

  async function byAI(waId, { text, image }, kind) {
    const allowed = await aiAllowed(waId);
    if (!allowed) return null;
    const list = await knownStores();
    const system = "Sos el asistente de GO! Delivery, en Magdalena (Buenos Aires). Un cliente pide que un cadete le compre cosas en uno o varios comercios. " +
      "Separá el pedido por comercio. store: el nombre del comercio como lo dijo el cliente; si coincide con uno de la lista de comercios conocidos, usá el nombre de la lista. " +
      "Si el cliente no dice dónde, usá \"El más cercano\" (o \"Farmacia más cercana\", etc. si se entiende el rubro). items: qué comprar ahí, con cantidades y aclaraciones, en el español del cliente. " +
      "is_order es false si el mensaje no es un pedido de compras (un saludo, una pregunta, un reclamo). No inventes productos ni comercios.\n\n" +
      `Comercios conocidos: ${list.slice(0, 300).join(" · ")}`;
    const content = [];
    if (image) content.push({ type: "image", source: { type: "base64", media_type: image.mime, data: image.data } });
    content.push({ type: "text", text: text ? `Mensaje del cliente:\n${String(text).slice(0, 2000)}` : "La foto es la lista del pedido." });
    try {
      const res = await anthropic().messages.create({
        model: allowed.model,
        max_tokens: 2000,
        system,
        messages: [{ role: "user", content }],
        output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      });
      db.collection("wa_ai_log").add({
        at: FieldValue.serverTimestamp(), waId, kind, model: allowed.model,
        inputTokens: res.usage && res.usage.input_tokens || 0, outputTokens: res.usage && res.usage.output_tokens || 0,
        stopReason: res.stop_reason || "",
      }).catch(() => {});
      if (res.stop_reason === "refusal" || res.stop_reason === "max_tokens") return null;
      const block = (res.content || []).find((b) => b.type === "text");
      const out = block ? JSON.parse(block.text) : null;
      if (!out || !out.is_order) return { stops: [] };
      const stops = (out.stops || []).map((s) => ({ store: String(s.store || "").trim().slice(0, 80), items: String(s.items || "").trim().slice(0, 600) }))
        .filter((s) => s.store && s.items).slice(0, MAX_STOPS);
      return { stops };
    } catch (err) {
      logger.warn("[WhatsApp] La IA no pudo leer el pedido:", err && err.message ? err.message : err);
      return null;
    }
  }

  // ── Audio → texto (Google Speech-to-Text v2, con la cuenta de servicio de las funciones) ──
  async function transcribe(buf) {
    if (!buf || process.env.FUNCTIONS_EMULATOR === "true") return null;
    try {
      const tok = await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", { headers: { "Metadata-Flavor": "Google" } });
      if (!tok.ok) return null;
      const { access_token: accessToken } = await tok.json();
      const project = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
      const res = await fetch(`https://speech.googleapis.com/v2/projects/${project}/locations/global/recognizers/_:recognize`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          config: { autoDecodingConfig: {}, languageCodes: ["es-AR"], model: "long", features: { enableAutomaticPunctuation: true } },
          content: buf.toString("base64"),
        }),
      });
      if (!res.ok) {
        logger.warn(`[WhatsApp] Speech-to-Text respondió ${res.status}: ${(await res.text()).slice(0, 300)}`);
        return null;
      }
      const data = await res.json();
      const text = (data.results || []).map((r) => r.alternatives && r.alternatives[0] && r.alternatives[0].transcript).filter(Boolean).join(" ").trim();
      db.collection("wa_ai_log").add({ at: FieldValue.serverTimestamp(), kind: "audio", seconds: Number(String((data.metadata && data.metadata.totalBilledDuration) || "0").replace("s", "")) || 0 }).catch(() => {});
      return text || null;
    } catch (err) {
      logger.warn("[WhatsApp] No se pudo transcribir el audio:", err && err.message ? err.message : err);
      return null;
    }
  }

  /**
   * Lo que mandó el cliente → paradas. msg: { text } o { media: { type, bytes, mime } }.
   * Devuelve { stops, via: "reglas"|"ia", heard? } o null si no se entendió como pedido.
   */
  async function order(waId, { text, media }, { useAI = true } = {}) {
    let heard = null;
    if (media && media.type === "audio") {
      heard = await transcribe(media.bytes);
      if (!heard) return null;
      text = heard;
    }
    if (media && media.type === "image") {
      if (!useAI || !media.bytes) return null;
      const r = await byAI(waId, { text, image: { mime: media.mime || "image/jpeg", data: media.bytes.toString("base64") } }, "foto");
      return r && r.stops.length ? { stops: r.stops, via: "ia" } : null;
    }
    if (!text) return null;
    const rules = await byRules(text);
    if (rules.complete) return { stops: rules.stops, via: "reglas", heard };
    if (!useAI) return rules.stops.length && rules.complete ? { stops: rules.stops, via: "reglas", heard } : null;
    const r = await byAI(waId, { text }, heard ? "audio" : "texto");
    if (r && r.stops.length) return { stops: r.stops, via: "ia", heard };
    return rules.stops.length ? { stops: rules.stops, via: "reglas", heard } : null;
  }

  return { order, byRules, looksLikeStoreName, matchKnown, knownStores, transcribe };
}

module.exports = { createUnderstand, MODEL_DEFAULT };
