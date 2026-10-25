// GoDelivery — Pushes automáticas (Admin → Campañas Push → Automáticas)
//
// Cada minuto processScheduledBroadcasts llama a runPushAutomations. Cada automatización
// (automated_broadcasts/{id}) tiene días, hora y una lista de mensajes (variants). Cuando le toca:
//
//   1. Elige un mensaje que no haya salido hace poco (recentKeys), así no se repite semana a semana.
//      Si llueve, prefiere los marcados lluvia; si no llueve, esos no salen.
//   2. {comercio} se reemplaza por un comercio de verdad abierto en ese momento (con foto, no pausado)
//      y el push lleva a su página. {dia} → "viernes". Se va rotando el comercio.
//   3. No sale si: no hay comercios abiertos de su rubro (mandados y viajes no miran comercios), no hay
//      repartidores conectados, ya salieron MAX_PER_DAY automáticas hoy o una hace menos de AUTO_GAP_H
//      horas, o se mandó una campaña a mano hace menos de MANUAL_GAP_H horas.
//      Mientras dure la ventana (WINDOW_MIN) lo vuelve a intentar cada minuto: si a las 20:15 no había
//      repartidores y a las 20:22 se conecta uno, sale a las 20:22.
//
// Lo que pasó queda en lastResult (el admin lo ve en la tarjeta) y lo enviado en broadcasts (Historial).
// Las automatizaciones de fábrica (DEFAULTS) se crean solas si faltan; las de la versión vieja
// (sin variants, que nunca llegaron a salir) se borran.

const { FieldValue, Timestamp } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");

const VERSION = 2;
const TZ = "America/Argentina/Buenos_Aires";
const WINDOW_MIN = 20;
const MAX_PER_DAY = 2;
const AUTO_GAP_H = 6;
const MANUAL_GAP_H = 6;
const RECENT_KEEP = 12;
const DAY_NAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const LEGACY_IDS = ["lunch_daily", "dinner_weekend", "mate_afternoon", "cart_abandoned", "inactive_users"];
// Comercios que no se nombran en promos (foto en blanco)
const HIDDEN_NAME_RE = /escabiad/i;

const DRIVER_ROLES = new Set(["delivery", "driver", "repartidor"]);
const STORE_ROLES = new Set(["comercio", "commerce"]);

const COMIDA = ["Comida", "Pizzería"];
const DULCE = ["Heladeria", "Postres"];

const LLUVIA_COMIDA = [
  { title: "🌧️ Llueve, pinta pedir algo rico", body: "Quedate en casa que GO! te lo lleva 🛵 Elegí qué comer y resolvé la cena.", lluvia: true },
  { title: "Día de lluvia, día de delivery ☔", body: "Nada de mojarse: elegí la cena en GO! y te la llevamos a casa.", lluvia: true },
];

const DEFAULTS = [
  {
    id: "cena_semana",
    name: "Cena entre semana",
    icon: "🍕",
    description: "Martes a la noche, antes del pico de pedidos de comida (21 a 22 h).",
    enabled: true,
    days: [2],
    time: "20:30",
    url: "/#/category/Comida",
    targetAudience: "clients",
    categories: COMIDA,
    requireDrivers: true,
    variants: [
      { title: "¿Qué se cena hoy? 🍕", body: "Dejá que la cocina descanse. Elegí algo rico en GO! y te lo llevamos a casa 🛵" },
      { title: "Hoy pinta {comercio} 🤤", body: "Abrí GO!, mirá la carta y pedí sin moverte del sillón." },
      { title: "Ni se te ocurra prender la hornalla 🔥", body: "Esta noche cocinan otros. Pedí por GO! y relajate." },
      { title: "¿Todavía no resolviste la cena? 🍔", body: "Hay locales abiertos ahora mismo en Magdalena. Elegí y te lo llevamos." },
      { title: "Un {dia} cualquiera también merece algo rico 😋", body: "Hamburguesas, pizzas, lomos... Elegí en GO! y llega a tu puerta." },
      { title: "{comercio} ya está abierto 🟢", body: "Pedí tu cena por GO! y seguila en vivo desde la app." },
      { title: "Cena resuelta en 3 toques 📲", body: "Elegí, pagá y esperá. Del resto se encarga GO! 🛵" },
      { title: "Hoy no se lavan platos 🍽️", body: "Pedí la cena por GO! y que el único plan sea comer rico." },
      { title: "¿Pizza, burger o lomo? 🤔", body: "Mirá qué hay abierto en GO! y decidí ahí mismo." },
      { title: "¿Se hizo tarde para cocinar? ⏰", body: "Para eso estamos. Pedí por GO! y en un rato lo tenés en casa." },
      { title: "Antojo detectado 👀", body: "Tu cena favorita está a un par de toques. Pedila por GO!" },
      { title: "Pinta {comercio} esta noche 🍔", body: "Entrá a GO! y pedí lo de siempre... o animate a algo nuevo." },
      ...LLUVIA_COMIDA,
    ],
  },
  {
    id: "cena_finde",
    name: "Cena de viernes y sábado",
    icon: "🍔",
    description: "La noche más fuerte de la semana.",
    enabled: true,
    days: [5, 6],
    time: "20:30",
    url: "/#/category/Comida",
    targetAudience: "clients",
    categories: COMIDA,
    requireDrivers: true,
    variants: [
      { title: "Es {dia}, ¿qué pedimos? 🍔", body: "Hoy la cena te llega a casa. Abrí GO! y elegí algo rico." },
      { title: "Arrancó el finde 🍕🍻", body: "Pizzas, burgers y bebidas frías. Pedí por GO! sin moverte de casa." },
      { title: "{dia} a la noche: no se cocina 😎", body: "Elegí qué cenar en GO! y disfrutá la noche." },
      { title: "Hoy pinta {comercio} 🤤", body: "Ya está abierto. Pedí por GO! y seguí tu pedido en vivo." },
      { title: "¿Juntada en casa? 🍻", body: "Resolvé la comida y la bebida en un solo lugar: GO!" },
      { title: "Plan de {dia}: sillón y delivery 🛋️", body: "Vos elegí la peli, la cena la llevamos nosotros." },
      { title: "¿Pinta bajón? 🚨", body: "Lo que tengas ganas de comer, tomar o picar, te lo llevamos." },
      { title: "{comercio} te espera 🔥", body: "Pedí desde GO! y en un rato está en tu puerta." },
      { title: "La noche recién empieza 🌙", body: "Pedí la cena por GO! y arrancala bien." },
      { title: "Que nadie cocine hoy 🙅", body: "Es {dia}: pedí por GO! y que cada uno elija lo suyo." },
      { title: "¿Pizza o burger? Las dos 🍕🍔", body: "Esta noche no hay que elegir. Mirá qué hay abierto en GO!" },
      { title: "Finde sin hornalla 🔥", body: "Comida rica y caliente, directo a tu casa con GO!" },
      ...LLUVIA_COMIDA,
    ],
  },
  {
    id: "domingo_noche",
    name: "Domingo a la noche",
    icon: "😴",
    description: "Cierre del finde: comida o algo dulce.",
    enabled: true,
    days: [0],
    time: "20:00",
    url: "/#/",
    targetAudience: "clients",
    categories: [...COMIDA, ...DULCE],
    requireDrivers: true,
    variants: [
      { title: "Domingo: hoy no se cocina 😴", body: "Terminá el finde como corresponde. Elegí lo que quieras en GO!" },
      { title: "Cerrá el finde con algo rico 🍕", body: "Mañana es lunes, hoy te mimás. Pedí por GO!" },
      { title: "¿Un heladito para cerrar el domingo? 🍦", body: "Pedite un cuartito de {comercio} y quedate en casa.", categories: ["Heladeria"] },
      { title: "Domingo de sillón 🛋️", body: "La cena la ponemos nosotros. Pedí por GO! y relajate." },
      { title: "Último antojo del finde 😋", body: "Hoy pinta {comercio}. Pedí desde GO! y te lo llevamos.", categories: COMIDA },
      { title: "Que el domingo termine rico 🍔", body: "Burgers, pizzas, helado... Elegí en GO! y listo." },
      { title: "Domingo a la noche, cero ganas de cocinar 🙃", body: "Normal. Para eso está GO! 🛵" },
      { title: "Se termina el finde 🥲", body: "Despedilo con algo rico: pedí por GO! sin moverte de casa." },
      { title: "Postre de domingo 🍨", body: "{comercio} está abierto. ¿Un postre para compartir?", categories: DULCE },
      { title: "¿Y si hoy pedimos? 🍕", body: "El domingo lo merece. Mirá qué hay abierto en GO!" },
      ...LLUVIA_COMIDA,
    ],
  },
  {
    id: "merienda",
    name: "Merienda",
    icon: "☕",
    description: "Apagada: a la tarde casi no se piden cosas dulces. Prendela si querés probar.",
    enabled: false,
    days: [3],
    time: "17:00",
    url: "/#/category/Heladeria",
    targetAudience: "clients",
    categories: DULCE,
    requireDrivers: true,
    variants: [
      { title: "Hora de la merienda ☕", body: "Algo dulce para la tarde: mirá qué hay en GO! y te lo llevamos." },
      { title: "¿Pinta algo dulce? 🍰", body: "Hoy pinta {comercio}. Pedilo por GO! y merendá en casa." },
      { title: "Un heladito a la tarde 🍦", body: "Nunca está de más. Pedí en {comercio} desde GO!", categories: ["Heladeria"] },
      { title: "Mate + algo rico = tarde perfecta 🧉", body: "Lo dulce lo ponemos nosotros. Pedí por GO!" },
      { title: "Antojo de la tarde 🍩", body: "Tortas, postres, helado... Elegí en GO! y llega a tu puerta." },
      { title: "{comercio} ya está abierto 🟢", body: "Date un gusto esta tarde y pedilo por GO!" },
      { title: "¿Merendamos? 🧁", body: "Dulce, rico y sin salir de casa. Entrá a GO!" },
      { title: "Te merecés algo rico 🍫", body: "Cortá la tarde con algo dulce. Pedilo por GO!" },
      { title: "Tarde de lluvia, mate y algo dulce ☔", body: "Quedate en casa: lo rico te lo llevamos con GO!", lluvia: true },
    ],
  },
  {
    id: "mandados_manana",
    name: "Mandados de mañana",
    icon: "🛍️",
    description: "Lo más pedido de GO!. Pico de 10 a 13 h. No depende de comercios abiertos.",
    enabled: true,
    days: [1, 6],
    time: "10:30",
    url: "/#/mandados",
    targetAudience: "clients",
    categories: [],
    requireDrivers: true,
    variants: [
      { title: "¿Te faltó algo? 🛍️", body: "Decinos qué necesitás y en qué comercio. Lo compramos y te lo llevamos." },
      { title: "Hacemos los mandados por vos 🛵", body: "Farmacia, almacén, verdulería, lo que sea: pedí un mandado en GO! y quedate en casa." },
      { title: "Arrancá el {dia} sin vueltas ☀️", body: "Los mandados te los hacemos nosotros. Pedilos desde GO!" },
      { title: "Servicio puerta a puerta 🚪", body: "Lo que necesites de cualquier comercio de Magdalena, te lo llevamos." },
      { title: "¿Mucho para hacer hoy? 😮‍💨", body: "Delegá los mandados: lo compramos y te lo llevamos con GO!" },
      { title: "Falta pan, falta leche... 🥖", body: "Te lo traemos nosotros. Pedí un mandado en GO!" },
      { title: "¿Las compras del almuerzo? 🛒", body: "Pasanos la lista y el comercio, y te lo llevamos antes del mediodía." },
      { title: "Retiramos y llevamos 📦", body: "¿Tenés que mandar o buscar algo? Pedí un mandado en GO! y listo." },
      { title: "No salgas por una cosa sola 🙌", body: "Pedí un mandado en GO! y te lo llevamos a casa." },
      { title: "¿Y si alguien va por vos? 😉", body: "Mandados a cualquier comercio de Magdalena con GO!" },
      { title: "¿Llueve y te falta algo? ☔", body: "No te mojes: pedí un mandado en GO! y te lo llevamos.", lluvia: true },
      { title: "Mañana de lluvia, mandados por GO! ☔", body: "Vos quedate adentro. Decinos qué necesitás y vamos nosotros.", lluvia: true },
    ],
  },
  {
    id: "mandados_tarde",
    name: "Mandados de tarde",
    icon: "🛵",
    description: "Lo más pedido de GO!. Segundo pico, de 18 a 22 h. No depende de comercios abiertos.",
    enabled: true,
    days: [3],
    time: "18:30",
    url: "/#/mandados",
    targetAudience: "clients",
    categories: [],
    requireDrivers: true,
    variants: [
      { title: "¿Te olvidaste algo en el súper? 🛒", body: "Tranqui, lo vamos a buscar. Pedí un mandado desde GO!" },
      { title: "Tu mandadero de confianza 🛵", body: "Cualquier comercio, cualquier cosa. Pedilo en GO!" },
      { title: "¿Volviste y te falta algo? 🏠", body: "No salgas de nuevo: pedí un mandado en GO! y te lo llevamos." },
      { title: "Lo de la cena, te lo compramos 🧺", body: "Pasanos la lista y el comercio. Del resto se encarga GO!" },
      { title: "Mandados hasta tarde 🌙", body: "¿Te quedó algo pendiente? Pedilo en GO! y te lo llevamos." },
      { title: "Hacemos los mandados por vos 🛵", body: "Kiosco, farmacia, almacén: pedí un mandado en GO! y quedate en casa." },
      { title: "Servicio puerta a puerta 🚪", body: "Lo que necesites de cualquier comercio de Magdalena, te lo llevamos." },
      { title: "¿Hay que buscar algo? 📦", body: "Retiramos y llevamos por toda Magdalena. Pedilo en GO!" },
      { title: "Un {dia} tranqui, sin salir 🛋️", body: "Si te falta algo, pedí un mandado en GO! y llega a tu puerta." },
      { title: "¿Llueve y te falta algo? ☔", body: "No te mojes: pedí un mandado en GO! y te lo llevamos.", lluvia: true },
    ],
  },
  {
    id: "viajes",
    name: "GO! Viajes",
    icon: "🏍️",
    description: "Viajes en moto. Todavía se piden poco: sirve para que la gente sepa que existen.",
    enabled: true,
    days: [4],
    time: "19:00",
    url: "/#/viajes",
    targetAudience: "clients",
    categories: [],
    requireDrivers: true,
    variants: [
      { title: "¿Tenés que ir a algún lado? 🏍️", body: "Pedí un viaje en moto con GO! y llegá rápido por Magdalena." },
      { title: "GO! también te lleva a vos 🏍️", body: "Además de pedidos y mandados, hacemos viajes en moto. Probalo desde la app." },
      { title: "Se te hizo tarde ⏰", body: "Pedí un viaje en moto en GO! y llegá a tiempo." },
      { title: "Viajes en moto por Magdalena 🛵", body: "Elegí origen y destino en GO! y un chofer te pasa a buscar." },
      { title: "¿Sin cómo volver? 🏍️", body: "Pedí tu viaje en moto con GO! y volvé tranqui." },
      { title: "Rápido y sin vueltas 💨", body: "Viajes en moto desde la app de GO!. Pedilo en un par de toques." },
      { title: "¿Vas para el centro? 📍", body: "Te llevamos en moto. Pedí tu viaje desde GO!" },
      { title: "Un viaje, a un toque 📲", body: "Abrí GO!, tocá Viajes y listo: te pasamos a buscar en moto." },
    ],
  },
  {
    id: "almuerzo",
    name: "Almuerzo",
    icon: "🍽️",
    description: "Apagada: al mediodía abren pocos locales de comida. Prendela si suman más.",
    enabled: false,
    days: [2, 3, 4, 5, 6],
    time: "11:45",
    url: "/#/category/Comida",
    targetAudience: "clients",
    categories: COMIDA,
    requireDrivers: true,
    variants: [
      { title: "¿Qué comemos hoy al mediodía? 🍽️", body: "Pedí tu almuerzo por GO! y olvidate de cocinar." },
      { title: "Hoy al mediodía pinta {comercio} 🤤", body: "Pedilo por GO! y comé tranqui en casa." },
      { title: "Se acerca el mediodía 🍔", body: "Elegí tu almuerzo en GO! y te lo llevamos calentito." },
      { title: "Almuerzo resuelto 👌", body: "Mirá qué hay abierto en GO! y pedí en un par de toques." },
      { title: "¿Sin tiempo para cocinar? ⏱️", body: "El almuerzo lo llevamos nosotros. Pedí por GO!" },
      { title: "{comercio} ya está cocinando 🔥", body: "Pedí tu almuerzo por GO! y que llegue a casa." },
    ],
  },
];

// ---------------------------------------------------------------- hora argentina

function argClock(date = new Date()) {
  const parts = {};
  new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, hour12: false, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", weekday: "short",
  }).formatToParts(date).forEach((p) => { parts[p.type] = p.value; });
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  const minutes = (Number(parts.hour) % 24) * 60 + Number(parts.minute);
  return { day, minutes, date: `${parts.year}-${parts.month}-${parts.day}` };
}

const toMinutes = (hhmm) => {
  const [h, m] = String(hhmm || "").split(":").map(Number);
  return Number.isInteger(h) && Number.isInteger(m) ? h * 60 + m : null;
};

// Le toca ahora: hoy es uno de sus días y estamos dentro de la ventana que arranca a su hora
function isDue(auto, clock) {
  const days = Array.isArray(auto.days) ? auto.days : [];
  const start = toMinutes(auto.time);
  if (start === null || !days.includes(clock.day)) return false;
  return clock.minutes >= start && clock.minutes < start + WINDOW_MIN;
}

// ---------------------------------------------------------------- comercios abiertos

function slotOpen(slot, t) {
  const o = toMinutes(slot?.open), c = toMinutes(slot?.close);
  if (o === null || c === null) return false;
  return c < o ? t >= o || t <= c : t >= o && t <= c;
}

// Igual que isShopOpen (src/utils/format.js), salvo que un comercio sin horario cargado cuenta como
// cerrado: no se puede asegurar que esté atendiendo y no conviene nombrarlo en un push.
function isOpenAt(c, clock) {
  const t = clock.minutes;
  const weekly = c.weeklySchedule;
  if (weekly && typeof weekly === "object" && Object.keys(weekly).length > 0) {
    const slotsOf = (d) => (Array.isArray(weekly[String(d)]) ? weekly[String(d)] : []);
    if (slotsOf(clock.day).some((s) => slotOpen(s, t))) return true;
    return slotsOf((clock.day + 6) % 7).some((s) => {
      const o = toMinutes(s?.open), cl = toMinutes(s?.close);
      return o !== null && cl !== null && cl < o && t <= cl;
    });
  }
  if (Array.isArray(c.daysOpen) && c.daysOpen.length > 0 && !c.daysOpen.includes(clock.day)) return false;
  const schedules = c.schedules || (c.schedule ? [c.schedule] : []);
  if (!Array.isArray(schedules) || schedules.length === 0) return false;
  return schedules.some((s) => slotOpen(s, t));
}

function categoriesOf(c) {
  const list = Array.isArray(c.categories) ? [...c.categories] : [];
  if (c.category) list.push(c.category);
  return list;
}

// Comercios que se pueden nombrar ahora: activos, sin pausa, con foto, abiertos
function openComercios(comercios, clock) {
  return comercios.filter((c) =>
    c.isActive !== false && c.isPaused !== true && !!c.logo && c.name &&
    !HIDDEN_NAME_RE.test(c.name) && isOpenAt(c, clock));
}

function inCategories(c, cats) {
  if (!cats || cats.length === 0) return true;
  return categoriesOf(c).some((x) => cats.includes(x));
}

// ---------------------------------------------------------------- elección del mensaje

const variantKey = (v) => `${v.title || ""}|${v.body || ""}`.slice(0, 120);
const needsComercio = (v) => /\{comercio\}/.test(`${v.title || ""} ${v.body || ""}`);

// Elige el mensaje. open = comercios abiertos (ya filtrados), raining = bool, recentKeys = los últimos
// que salieron (el primero es el más nuevo). Devuelve { variant, comercio } o null si ninguno sirve.
function pickVariant(auto, { open, raining, recentKeys = [], recentComercios = [], random = Math.random }) {
  const variants = (Array.isArray(auto.variants) ? auto.variants : []).filter((v) => v && (v.body || v.title));
  const pool = (v) => open.filter((c) => inCategories(c, v.categories || auto.categories));

  const usable = variants.filter((v) => {
    const cats = v.categories || auto.categories;
    if (cats && cats.length > 0 && pool(v).length === 0) return false;
    if (needsComercio(v) && pool(v).length === 0) return false;
    return true;
  });
  const rainy = usable.filter((v) => v.lluvia === true);
  const dry = usable.filter((v) => v.lluvia !== true);
  const candidates = raining && rainy.length > 0 ? rainy : dry;
  if (candidates.length === 0) return null;

  // Los que salieron hace poco quedan afuera: más o menos la mitad del total, así recorre todos
  // antes de repetir y la vuelta siguiente no sale en el mismo orden.
  const limit = Math.max(1, Math.floor(candidates.length * 0.6));
  const blocked = new Set(recentKeys.slice(0, limit));
  let fresh = candidates.filter((v) => !blocked.has(variantKey(v)));
  if (fresh.length === 0) {
    // Todos salieron hace poco: el que hace más tiempo que no sale
    const age = (v) => { const i = recentKeys.indexOf(variantKey(v)); return i === -1 ? Infinity : i; };
    const oldest = Math.max(...candidates.map(age));
    fresh = candidates.filter((v) => age(v) === oldest);
  }
  const variant = fresh[Math.floor(random() * fresh.length)];

  let comercio = null;
  if (needsComercio(variant)) {
    const options = pool(variant);
    const notRecent = options.filter((c) => !recentComercios.includes(c.id));
    const from = notRecent.length > 0 ? notRecent : options;
    comercio = from[Math.floor(random() * from.length)];
  }
  return { variant, comercio };
}

function fillText(text, { comercio, clock }) {
  const out = String(text || "")
    .replace(/\{comercio\}/g, comercio ? comercio.name.trim() : "")
    .replace(/\{dia\}/g, DAY_NAMES[clock.day] || "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return out.charAt(0).toUpperCase() + out.slice(1);
}

// ---------------------------------------------------------------- destinatarios

function audienceOf(user) {
  const role = String(user?.role || "").toLowerCase();
  if (DRIVER_ROLES.has(role)) return "drivers";
  if (STORE_ROLES.has(role)) return "stores";
  return "clients"; // "user" (casi todos), "client", "admin" o sin rol
}

// Tokens de los dispositivos de un público: "all", "clients", "drivers", "stores" o "me" (con uid).
// Los clientes tienen role "user" en la base: filtrar por "client" dejaba afuera a casi todos.
// owners (Map token → uid, el tokenOwners de index.js) se llena para que sendPush borre los muertos.
async function tokensForAudience(db, audience, { uid = null, owners = null } = {}) {
  if (audience === "me") {
    if (!uid) return [];
    const snap = await db.collection("users").doc(uid).collection("fcmTokens").get();
    const mine = snap.docs.map((d) => d.data().token).filter(Boolean);
    if (owners) mine.forEach((t) => owners.set(t, uid));
    return [...new Set(mine)];
  }
  const snap = await db.collectionGroup("fcmTokens").get();
  const byOwner = new Map();
  snap.docs.forEach((d) => {
    const token = d.data().token;
    const owner = d.ref.parent.parent?.id;
    if (!token || !owner) return;
    if (!byOwner.has(owner)) byOwner.set(owner, []);
    byOwner.get(owner).push(token);
    if (owners) owners.set(token, owner);
  });
  if (audience === "all") return [...new Set([...byOwner.values()].flat())];

  const uids = [...byOwner.keys()];
  const tokens = [];
  for (let i = 0; i < uids.length; i += 100) {
    const refs = uids.slice(i, i + 100).map((id) => db.collection("users").doc(id));
    const users = await db.getAll(...refs);
    users.forEach((u) => {
      if (audienceOf(u.exists ? u.data() : null) === audience) tokens.push(...byOwner.get(u.id));
    });
  }
  return [...new Set(tokens)];
}

// ---------------------------------------------------------------- estado del momento

function isRainingNow(global, weather) {
  const mode = global?.rainMode || "auto";
  if (mode === "on") return true;
  if (mode === "off") return false;
  return weather?.isRaining === true;
}

// ¿Se mandó una campaña a mano hace poco, o hay una programada para dentro de poco?
async function manualCampaignNearby(db, nowMs) {
  const since = Timestamp.fromMillis(nowMs - MANUAL_GAP_H * 3600e3);
  const [created, sent, scheduled] = await Promise.all([
    db.collection("broadcasts").where("createdAt", ">=", since).get(),
    db.collection("broadcasts").where("sentAt", ">=", since).get(),
    db.collection("broadcasts").where("status", "==", "scheduled").get(),
  ]);
  const manual = (d) => d.data().isAutomated !== true && ["sent", "sending"].includes(d.data().status);
  if (created.docs.some(manual) || sent.docs.some(manual)) return true;
  const soon = nowMs + 3 * 3600e3;
  return scheduled.docs.some((d) => {
    const at = d.data().scheduledAt?.toMillis?.() || 0;
    return at > 0 && at <= soon;
  });
}

// ---------------------------------------------------------------- fábrica

async function ensureDefaults(db, docs) {
  const byId = new Map(docs.map((d) => [d.id, d]));
  const batch = db.batch();
  let changes = 0;
  for (const def of DEFAULTS) {
    if (byId.get(def.id)?.data().version === VERSION) continue;
    batch.set(db.collection("automated_broadcasts").doc(def.id), {
      ...def, version: VERSION, recentKeys: [], recentComercios: [], createdAt: FieldValue.serverTimestamp(),
    });
    changes++;
  }
  for (const id of LEGACY_IDS) {
    const old = byId.get(id);
    if (old && old.data().version !== VERSION) { batch.delete(old.ref); changes++; }
  }
  if (changes > 0) {
    await batch.commit();
    logger.info(`[Push automáticas] Automatizaciones de fábrica creadas/actualizadas: ${changes}`);
    return true;
  }
  return false;
}

// ---------------------------------------------------------------- pasada

async function setResult(ref, auto, clock, status, text) {
  const prev = auto.lastResult || {};
  if (prev.date === clock.date && prev.status === status && prev.text === text) return;
  await ref.update({ lastResult: { date: clock.date, status, text, at: FieldValue.serverTimestamp() } });
}

// deps: { db, sendPush, tokenOwners?: Map, now?: Date, random?: fn }. Devuelve un resumen de lo que hizo (para tests y logs).
async function runPushAutomations({ db, sendPush, tokenOwners = null, now = new Date(), random = Math.random }) {
  const col = db.collection("automated_broadcasts");
  let snap = await col.get();
  if (await ensureDefaults(db, snap.docs)) snap = await col.get();

  const clock = argClock(now);
  const all = snap.docs.filter((d) => d.data().version === VERSION);
  const due = all.filter((d) => {
    const a = d.data();
    return a.enabled === true && a.lastSentDate !== clock.date && isDue(a, clock);
  });
  const summary = [];
  if (due.length === 0) return summary;

  // Todo lo que hace falta saber para decidir se lee una sola vez
  const [comerciosSnap, driversDoc, globalDoc, weatherDoc, manualNearby] = await Promise.all([
    db.collection("comercios").get(),
    db.collection("settings").doc("driverAvailability").get(),
    db.collection("settings").doc("global").get(),
    db.collection("settings").doc("weather").get(),
    manualCampaignNearby(db, now.getTime()),
  ]);
  const open = openComercios(comerciosSnap.docs.map((d) => ({ id: d.id, ...d.data() })), clock);
  const driversOnline = Number(driversDoc.data()?.onlineCount) || 0;
  const raining = isRainingNow(globalDoc.data(), weatherDoc.data());
  const sentToday = all.filter((d) => d.data().lastSentDate === clock.date)
    .map((d) => d.data().lastSentAt?.toMillis?.() || now.getTime());

  // Si dos coinciden, primero la de hora más temprana
  due.sort((a, b) => toMinutes(a.data().time) - toMinutes(b.data().time));

  for (const docSnap of due) {
    const auto = docSnap.data();
    const ref = docSnap.ref;
    const skip = async (text) => {
      await setResult(ref, auto, clock, "skipped", text);
      summary.push({ id: docSnap.id, status: "skipped", text });
    };

    if (sentToday.length >= MAX_PER_DAY) { await skip(`Hoy ya salieron ${MAX_PER_DAY} automáticas`); continue; }
    if (sentToday.some((at) => now.getTime() - at < AUTO_GAP_H * 3600e3)) {
      await skip(`Salió otra automática hace menos de ${AUTO_GAP_H} h`);
      continue;
    }
    if (manualNearby) { await skip(`Hubo o hay una campaña manual a menos de ${MANUAL_GAP_H} h`); continue; }
    if (auto.requireDrivers !== false && driversOnline === 0) { await skip("No había repartidores conectados"); continue; }
    const cats = Array.isArray(auto.categories) ? auto.categories : [];
    if (cats.length > 0 && !open.some((c) => inCategories(c, cats))) {
      await skip(`No había comercios abiertos de ${cats.join(" / ")}`);
      continue;
    }
    const pick = pickVariant(auto, {
      open, raining, random,
      recentKeys: Array.isArray(auto.recentKeys) ? auto.recentKeys : [],
      recentComercios: Array.isArray(auto.recentComercios) ? auto.recentComercios : [],
    });
    if (!pick) { await skip("Ningún mensaje sirve con lo que hay abierto ahora"); continue; }

    // Se reserva el día antes de mandar: si otra instancia corre a la vez, no sale dos veces
    const claimed = await db.runTransaction(async (tx) => {
      const fresh = await tx.get(ref);
      if (fresh.data()?.lastSentDate === clock.date) return false;
      tx.update(ref, { lastSentDate: clock.date, lastSentAt: FieldValue.serverTimestamp() });
      return true;
    });
    if (!claimed) continue;
    sentToday.push(now.getTime());

    const { variant, comercio } = pick;
    const title = fillText(variant.title || "GO!", { comercio, clock });
    const body = fillText(variant.body, { comercio, clock });
    const url = comercio ? `/#/comercio/${comercio.id}` : (variant.url || auto.url || "/#/");
    const audience = auto.targetAudience || "clients";

    let tokens = [];
    try {
      tokens = await tokensForAudience(db, audience, { owners: tokenOwners });
    } catch (err) {
      logger.error(`[Push automáticas] No se pudieron leer los tokens para ${docSnap.id}:`, err);
    }

    const broadcastRef = await db.collection("broadcasts").add({
      title, body, url, imageUrl: "",
      targetAudience: audience,
      status: "sent",
      sentCount: tokens.length,
      clicks: 0,
      isAutomated: true,
      automationId: docSnap.id,
      automationName: auto.name || "Automática",
      comercioId: comercio?.id || null,
      raining,
      createdAt: FieldValue.serverTimestamp(),
      sentAt: FieldValue.serverTimestamp(),
    });

    if (tokens.length > 0) {
      try {
        await sendPush(tokens, { title, body }, {
          url, type: "automated_push", automationId: docSnap.id, broadcastId: broadcastRef.id, imageUrl: "",
        });
      } catch (err) {
        logger.error(`[Push automáticas] Error mandando ${docSnap.id}:`, err);
      }
    }

    const key = variantKey(variant);
    await ref.update({
      recentKeys: [key, ...(auto.recentKeys || []).filter((k) => k !== key)].slice(0, RECENT_KEEP),
      recentComercios: comercio
        ? [comercio.id, ...(auto.recentComercios || []).filter((id) => id !== comercio.id)].slice(0, 3)
        : (auto.recentComercios || []),
      lastResult: {
        date: clock.date, status: "sent", at: FieldValue.serverTimestamp(),
        text: `Enviada a ${tokens.length} dispositivos: "${title}"`,
      },
    });
    logger.info(`[Push automáticas] ${docSnap.id} → ${tokens.length} dispositivos: ${title} / ${body}`);
    summary.push({ id: docSnap.id, status: "sent", title, body, url, count: tokens.length, broadcastId: broadcastRef.id });
  }
  return summary;
}

module.exports = {
  runPushAutomations,
  tokensForAudience,
  // para tests
  DEFAULTS, VERSION, WINDOW_MIN, MAX_PER_DAY, AUTO_GAP_H, MANUAL_GAP_H,
  argClock, isDue, isOpenAt, openComercios, pickVariant, fillText, variantKey, audienceOf,
};
