// Horarios del comercio: lectura del formato por día (weeklySchedule) con respaldo
// en el formato viejo (schedules + daysOpen), y frases cortas para el panel.
import { getArgentinaTime, isShopOpen } from './format.js';

export const DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
export const DAY_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
// Lunes primero, como se piensa la semana en el mostrador
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

export function getWeeklySchedule(c = {}) {
  if (c.weeklySchedule && typeof c.weeklySchedule === 'object' && Object.keys(c.weeklySchedule).length) {
    const out = {};
    for (let d = 0; d < 7; d++) out[d] = Array.isArray(c.weeklySchedule[d]) ? c.weeklySchedule[d].filter(s => s?.open && s?.close) : [];
    return out;
  }
  const slots = Array.isArray(c.schedules) ? c.schedules : (c.schedule ? [c.schedule] : []);
  const days = Array.isArray(c.daysOpen) && c.daysOpen.length ? c.daysOpen : [0, 1, 2, 3, 4, 5, 6];
  const out = {};
  for (let d = 0; d < 7; d++) out[d] = days.includes(d) ? slots.filter(s => s?.open && s?.close).map(s => ({ open: s.open, close: s.close })) : [];
  return out;
}

// Para las versiones viejas que sólo leen schedules/daysOpen: días con turnos y los
// turnos del primer día abierto.
export function legacyFromWeekly(weekly) {
  const daysOpen = [];
  let schedules = [];
  for (let d = 0; d < 7; d++) {
    if (weekly[d]?.length) {
      daysOpen.push(d);
      if (!schedules.length) schedules = weekly[d].map(s => ({ open: s.open, close: s.close }));
    }
  }
  return { daysOpen, schedules };
}

export function isComercioOpenNow(c = {}) {
  return isShopOpen(c.schedules || (c.schedule ? [c.schedule] : []), c.daysOpen, c.weeklySchedule);
}

const minutes = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + m; };
const hhmm = (mins) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
const WEEK_MIN = 7 * 1440;

// Abierto en ese día y minuto (mismas reglas que isOpenByWeeklySchedule: el minuto de cierre
// cuenta como abierto y un turno que pasa la medianoche sigue el día siguiente)
function openAt(weekly, day, t) {
  const inSlot = (s, overnightOnly) => {
    const o = minutes(s.open), c = minutes(s.close);
    if (overnightOnly) return c < o && t <= c;
    return c < o ? t >= o : t >= o && t <= c;
  };
  return weekly[day].some(s => inSlot(s, false)) || weekly[(day + 6) % 7].some(s => inSlot(s, true));
}

/**
 * Cuándo cierra de verdad, siguiendo los minutos abiertos aunque crucen la medianoche o varios
 * días (un kiosco abierto de corrido el fin de semana cierra el lunes, no "a las 23:59").
 * Devuelve "las 02:00" / "el lunes 02:00", o null si no cierra en toda la semana.
 */
export function closesAtText(c = {}) {
  const weekly = getWeeklySchedule(c);
  const now = getArgentinaTime();
  const day = now.getDay();
  const t = now.getHours() * 60 + now.getMinutes();
  let i = 0;
  while (i < WEEK_MIN && openAt(weekly, (day + Math.floor((t + i + 1) / 1440)) % 7, (t + i + 1) % 1440)) i++;
  if (i >= WEEK_MIN) return null;
  const end = t + i;
  const daysAhead = Math.floor(end / 1440);
  const time = hhmm(end % 1440);
  // Desde cuándo está abierto sin cortar: si lleva más de un día (fin de semana de corrido), se
  // nombra el día aunque cierre esta madrugada ("el lunes 02:00" también el domingo a la noche)
  let since = 0;
  while (since < WEEK_MIN && openAt(weekly, (day + 7 * 2 + Math.floor((t - since - 1) / 1440)) % 7, ((t - since - 1) % 1440 + 1440) % 1440)) since++;
  const longStretch = since + i >= 1440;
  // Hoy, o la madrugada de mañana (cierra a las 02:00): alcanza con la hora
  if (daysAhead === 0 || (!longStretch && daysAhead === 1 && end % 1440 < 12 * 60)) return `las ${time}`;
  return `el ${DAY_NAMES[(day + daysAhead) % 7].toLowerCase()} ${time}`;
}

/** Cuándo vuelve a abrir: "hoy 06:00" / "mañana 06:00" / "el lunes 06:00", o null sin horario. */
export function opensAtText(c = {}) {
  const weekly = getWeeklySchedule(c);
  const now = getArgentinaTime();
  const day = now.getDay();
  const t = now.getHours() * 60 + now.getMinutes();
  for (let i = 1; i <= WEEK_MIN; i++) {
    const d = (day + Math.floor((t + i) / 1440)) % 7;
    if (openAt(weekly, d, (t + i) % 1440)) {
      const daysAhead = Math.floor((t + i) / 1440);
      const time = hhmm((t + i) % 1440);
      if (daysAhead === 0) return `hoy ${time}`;
      if (daysAhead === 1) return `mañana ${time}`;
      return `el ${DAY_NAMES[d].toLowerCase()} ${time}`;
    }
  }
  return null;
}

export function formatSlots(slots = []) {
  if (!slots.length) return 'Cerrado';
  return slots.map(s => `${s.open} a ${s.close}`).join(' y ');
}

// "Cierra 23:30" / "Abre hoy 19:00" / "Abre el lunes 08:00" / "Sin horario cargado"
export function scheduleStatusLine(c = {}) {
  const weekly = getWeeklySchedule(c);
  const hasAny = Object.values(weekly).some(s => s.length);
  if (!hasAny) return 'Sin horarios cargados';
  const now = getArgentinaTime();
  const day = now.getDay();
  const t = now.getHours() * 60 + now.getMinutes();

  if (isComercioOpenNow(c)) {
    const until = closesAtText(c);
    return until ? `Cierra ${until.replace(/^las /, '')}` : 'Abierto las 24 horas';
  }
  const later = weekly[day].map(s => s.open).filter(o => minutes(o) > t).sort((a, b) => minutes(a) - minutes(b))[0];
  if (later) return `Abre hoy ${later}`;
  for (let i = 1; i <= 7; i++) {
    const d = (day + i) % 7;
    if (weekly[d].length) {
      const first = [...weekly[d]].sort((a, b) => minutes(a.open) - minutes(b.open))[0].open;
      return i === 1 ? `Abre mañana ${first}` : `Abre el ${DAY_NAMES[d].toLowerCase()} ${first}`;
    }
  }
  return 'Cerrado';
}
