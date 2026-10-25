// Venta por peso en el servidor: mismas cuentas que src/utils/weight.js (la app).
// El producto guarda el precio por kilo y el paso en gramos; `qty` del carrito cuenta pasos.

const WEIGHT_STEPS = [100, 250, 500, 1000];
const DEFAULT_WEIGHT_STEP = 250;

const isSoldByWeight = (pData) => !!pData && pData.soldByWeight === true;

function weightStepOf(pData) {
  const step = Number(pData && pData.weightStep);
  return WEIGHT_STEPS.includes(step) ? step : DEFAULT_WEIGHT_STEP;
}

// perKg: precio por kilo con opciones ya sumadas (secureUnitPrice). Devuelve el precio de un paso.
const stepPrice = (perKg, pData) => (Number(perKg) || 0) * weightStepOf(pData) / 1000;

module.exports = { WEIGHT_STEPS, DEFAULT_WEIGHT_STEP, isSoldByWeight, weightStepOf, stepPrice };
