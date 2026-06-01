// GoDelivery — Utility: Formatters
export function formatPrice(amount) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount);
}

export function formatDate(timestamp) {
  if (!timestamp) return '';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(date);
}

export function truncateText(text, maxLength = 60) {
  if (!text || text.length <= maxLength) return text || '';
  return text.slice(0, maxLength) + '...';
}

export function getArgentinaTime() {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const artOffset = -3;
  return new Date(utc + (3600000 * artOffset));
}

export function isShopOpen(schedules) {
  if (!schedules || schedules.length === 0) return true;
  
  const now = getArgentinaTime();
  const currentTime = now.getHours() * 60 + now.getMinutes();

  return schedules.some(slot => {
    if (!slot || !slot.open || !slot.close) return false;
    
    try {
      const [openH, openM] = slot.open.split(':').map(Number);
      const [closeH, closeM] = slot.close.split(':').map(Number);
      
      if (isNaN(openH) || isNaN(openM) || isNaN(closeH) || isNaN(closeM)) return false;

      const openMinutes = openH * 60 + openM;
      const closeMinutes = closeH * 60 + closeM;

      if (closeMinutes < openMinutes) {
        return currentTime >= openMinutes || currentTime <= closeMinutes;
      }
      
      return currentTime >= openMinutes && currentTime <= closeMinutes;
    } catch (e) {
      console.warn('Error parsing schedule:', slot, e);
      return false;
    }
  });
}

