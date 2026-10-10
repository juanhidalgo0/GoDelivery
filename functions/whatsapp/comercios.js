// Comercios para el bot: cuáles están abiertos ahora, búsqueda por nombre y link a su tienda.
// El horario se interpreta igual que en la app (src/utils/format.js isShopOpen).

const APP_URL = "https://godelivery-magdalena.web.app";

function argentinaNow() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Argentina/Buenos_Aires", hour12: false, weekday: "short", hour: "2-digit", minute: "2-digit",
  }).formatToParts(new Date());
  const map = {};
  parts.forEach((p) => { map[p.type] = p.value; });
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(map.weekday);
  return { day, t: (parseInt(map.hour, 10) % 24) * 60 + parseInt(map.minute, 10) };
}

const toMin = (hhmm) => {
  const [h, m] = String(hhmm || "").split(":").map(Number);
  return Number.isNaN(h) || Number.isNaN(m) ? null : h * 60 + m;
};

function isOpenNow(c, now = argentinaNow()) {
  const { day, t } = now;
  const weekly = c.weeklySchedule;
  if (weekly && typeof weekly === "object" && Object.keys(weekly).length) {
    const slots = (d) => (Array.isArray(weekly[String(d)]) ? weekly[String(d)] : []);
    const today = slots(day).some((s) => {
      const o = toMin(s && s.open), cl = toMin(s && s.close);
      if (o === null || cl === null) return false;
      return cl < o ? t >= o : t >= o && t <= cl;
    });
    if (today) return true;
    // Turno de ayer que pasa la medianoche
    return slots((day + 6) % 7).some((s) => {
      const o = toMin(s && s.open), cl = toMin(s && s.close);
      return o !== null && cl !== null && cl < o && t <= cl;
    });
  }
  if (Array.isArray(c.daysOpen) && c.daysOpen.length && !c.daysOpen.includes(day)) return false;
  const schedules = c.schedules || (c.schedule ? [c.schedule] : []);
  if (!schedules.length) return true;
  return schedules.some((s) => {
    const o = toMin(s && s.open), cl = toMin(s && s.close);
    if (o === null || cl === null) return false;
    return cl < o ? t >= o || t <= cl : t >= o && t <= cl;
  });
}

const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

function createSlug(text) {
  return String(text || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50);
}

const storeUrl = (c) => `${APP_URL}/#/tienda/${c.slug || createSlug(c.name) || c.id}`;

function createComercios(db) {
  let cache = { at: 0, list: [] };

  // Los aprobados y visibles (como en el inicio de la app). Se cachea un minuto.
  async function listVisible() {
    if (Date.now() - cache.at < 60000) return cache.list;
    const snap = await db.collection("comercios").where("approvedByAdmin", "==", true).get();
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((c) => c.isActive !== false && c.name);
    cache = { at: Date.now(), list };
    return list;
  }

  const isAvailable = (c) => c.isPaused !== true && c.isOpen !== false && isOpenNow(c);

  async function listOpen() {
    const list = await listVisible();
    return list.filter(isAvailable)
      .sort((a, b) => (Number(b.rating) || 0) - (Number(a.rating) || 0) || String(a.name).localeCompare(String(b.name)));
  }

  async function search(text) {
    const q = norm(text);
    if (q.length < 2) return [];
    const list = await listVisible();
    const exact = list.filter((c) => norm(c.name) === q);
    if (exact.length) return exact;
    const words = q.split(" ").filter((w) => w.length >= 2);
    return list.filter((c) => {
      const n = norm(c.name);
      return n.includes(q) || (words.length && words.every((w) => n.includes(w)));
    }).slice(0, 10);
  }

  async function get(id) {
    const snap = await db.collection("comercios").doc(id).get();
    return snap.exists ? { id: snap.id, ...snap.data() } : null;
  }

  async function hasCatalog(id) {
    const snap = await db.collection("comercios").doc(id).collection("products").limit(5).get();
    return snap.docs.some((d) => d.data().isAvailable !== false);
  }

  // ¿El que escribe es un comercio? users.phone y comercios.phone se guardan con 10 dígitos.
  async function byPhone(national) {
    if (!national) return null;
    for (const field of ["phone", "whatsapp"]) {
      const snap = await db.collection("comercios").where(field, "==", national).limit(1).get();
      if (!snap.empty) return { id: snap.docs[0].id, ...snap.docs[0].data() };
    }
    return null;
  }

  return { listOpen, search, get, hasCatalog, byPhone, isAvailable };
}

module.exports = { createComercios, isOpenNow, norm, storeUrl, APP_URL };
