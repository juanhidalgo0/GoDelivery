// Vehículos para los Viajes. Desde el 09-10-2026 solo hay viajes en moto: el auto se sacó de
// la app (pedir, postularse como chofer, configurar el vehículo) hasta que se decida volver.
// Para volver a ofrecer autos alcanza con poner esto en true; los pedidos viejos con
// tripType 'auto' se siguen mostrando bien en los dos casos.
export const CAR_TRIPS_ENABLED = false;

// Opciones para los selectores de vehículo de choferes (valor tal como se guarda hoy)
export function tripVehicleOptions(selected = 'moto', { capitalized = false } = {}) {
  const list = [{ v: 'moto', label: '🏍️ Moto' }, ...(CAR_TRIPS_ENABLED ? [{ v: 'auto', label: '🚗 Auto' }] : [])];
  const sel = String(selected || 'moto').toLowerCase();
  return list.map(o => {
    const value = capitalized ? o.v[0].toUpperCase() + o.v.slice(1) : o.v;
    return `<option value="${value}" ${o.v === sel ? 'selected' : ''}>${o.label}</option>`;
  }).join('');
}
