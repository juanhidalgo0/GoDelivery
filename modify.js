const fs = require('fs');

// delivery-panel.js modifications
const deliveryPath = 'src/pages/delivery-panel.js';
let delCode = fs.readFileSync(deliveryPath, 'utf8');

if (!delCode.includes('HOTSPOTS IMPLEMENTATION')) {
  delCode = delCode.replace(
    /export async function renderDeliveryPanel/,
    "// HOTSPOTS IMPLEMENTATION & ROUND ROBIN QUEUE\nwindow.autoAcceptEnabled = false;\nexport async function renderDeliveryPanel"
  );
}

if (!delCode.includes('Auto-Aceptar')) {
  delCode = delCode.replace(
    /<div class="tab-pills"/,
    `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 10px;">
       <label style="display:flex; align-items:center; gap:8px; font-size:13px; font-weight:700; color:var(--color-text-primary);">
         <input type="checkbox" id="auto-accept-toggle" onchange="window.autoAcceptEnabled = this.checked;" /> Auto-Aceptar
       </label>
     </div>
     <div class="tab-pills"`
  );
}

fs.writeFileSync(deliveryPath, delCode);

// orders.js modifications
const ordersPath = 'src/pages/comercio-panel/orders.js';
let ordCode = fs.readFileSync(ordersPath, 'utf8');

if (!ordCode.includes('Asignar Repartidor Manual')) {
  ordCode = ordCode.replace(
    /<div class="action-grid-2">/,
    `<button class="btn-action-premium manual-assign-btn" data-id="\${o.id}" style="background:var(--color-warning); color:white; border:none; margin-bottom:8px;">Asignar Repartidor Manual</button>\n            <div class="action-grid-2">`
  );
}

fs.writeFileSync(ordersPath, ordCode);
console.log('Modifications applied successfully.');
