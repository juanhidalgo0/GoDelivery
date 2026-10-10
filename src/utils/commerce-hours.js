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
    const running = [...weekly[day], ...weekly[(day + 6) % 7].filter(s => minutes(s.close) < minutes(s.open))]
      .find(s => {
        const o = minutes(s.open), cl = minutes(s.close);
        return cl < o ? (t >= o || t <= cl) : (t >= o && t <= cl);
      });
    return running ? `Cierra ${running.close}` : 'Abierto';
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
