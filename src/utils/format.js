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

export function isShopOpen(schedules, daysOpen) {
  const now = getArgentinaTime();
  if (Array.isArray(daysOpen) && daysOpen.length > 0) {
    const currentDay = now.getDay();
    if (!daysOpen.includes(currentDay)) return false;
  }
  if (!schedules || schedules.length === 0) return true;
  
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

export function formatDeliveryTime(distanceKm) {
  if (distanceKm === null || distanceKm === undefined) return '25-40 min';
  
  // 1. Acceptance Delay (time it takes for the commerce to accept the order): ~4 min
  const acceptanceDelay = 4;
  
  // 2. Preparation Time (time to prepare the food/items): ~15 min
  const prepTime = 15;
  
  // 3. Driver Pickup Time (driver assignment + travel to store + pickup): ~6 min
  const riderToStoreTime = 6;
  
  // 4. Transit Time (store to customer travel): ~3.5 min per km
  const travelToCustomerTime = distanceKm * 3.5;
  
  // Total Estimated Time
  const totalMinutes = acceptanceDelay + prepTime + riderToStoreTime + travelToCustomerTime;
  
  const minTime = Math.max(20, Math.round(totalMinutes - 5));
  const maxTime = Math.max(35, Math.round(totalMinutes + 5));
  
  return `${minTime}-${maxTime} min`;
}

export function isScheduleActive(config) {
  if (!config || !config.enabled) return false;
  
  const now = getArgentinaTime();
  const currentTime = now.getHours() * 60 + now.getMinutes();

  try {
    const [startH, startM] = config.start.split(':').map(Number);
    const [endH, endM] = config.end.split(':').map(Number);
    
    if (isNaN(startH) || isNaN(startM) || isNaN(endH) || isNaN(endM)) return false;

    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    if (endMinutes < startMinutes) {
      // Overnight schedule, e.g. 23:00 to 06:00
      return currentTime >= startMinutes || currentTime <= endMinutes;
    } else {
      // Normal schedule, e.g. 12:00 to 15:00
      return currentTime >= startMinutes && currentTime <= endMinutes;
    }
  } catch (e) {
    return false;
  }
}

export function calculateScheduleSurcharge(config, baseValue) {
  if (!config || !config.enabled) return 0;
  
  try {
    const isActive = isScheduleActive(config);
    if (isActive) {
      if (config.type === 'fixed') return config.value;
      if (config.type === 'percentage') return baseValue * (config.value / 100);
    }
  } catch (e) {
    console.warn('Error calculating schedule surcharge:', e);
  }
  return 0;
}

