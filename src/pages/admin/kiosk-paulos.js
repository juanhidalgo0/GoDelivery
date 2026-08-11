import { db } from '../../firebase.js';
import { doc, getDoc, setDoc, collection, query, where, getDocs, writeBatch, serverTimestamp } from 'firebase/firestore';
import { isAdmin } from '../../auth.js';
import { icon } from '../../utils/icons.js';
import { formatPrice } from '../../utils/format.js';
import { showToast } from '../../components/toast.js';
import { showConfirm } from '../../components/modal.js';

const localDate = new Date();
const year = localDate.getFullYear();
const month = String(localDate.getMonth() + 1).padStart(2, '0');
let currentSelectedMonth = `${year}-${month}`; // e.g. "2026-08"

export async function renderAdminKioskPaulos() {
  const content = document.getElementById('app-content');
  if (!content) return;

  if (!isAdmin()) {
    content.innerHTML = `<div class="empty-state"><p>No tenés acceso a esta sección.</p></div>`;
    return;
  }

  content.innerHTML = `
    <div class="panel-page" style="display:flex; flex-direction:column; height:100dvh; background:var(--color-bg); overflow:hidden;">
      <!-- Header -->
      <div style="background: linear-gradient(135deg, #2e1065 0%, #4c1d95 50%, #6b21a8 100%); padding:calc(16px + env(safe-area-inset-top, 0px)) 20px 16px; display:flex; align-items:center; gap:16px; flex-shrink:0; position:relative; overflow:hidden; box-shadow:0 4px 16px rgba(76,29,149,0.3); z-index:100;">
        <a href="#/admin/settings" style="display:flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:12px;background:rgba(255,255,255,0.15);color:white;flex-shrink:0;text-decoration:none;transition:all 0.2s;">
          ${icon('chevronLeft', 24)}
        </a>
        <div style="flex:1;min-width:0;position:relative;z-index:2;">
          <h1 style="font-family:var(--font-display);font-weight:950;font-size:19px;color:white;margin:0;line-height:1.2;letter-spacing:-0.02em;">Convenio Maxikiosco Paulos</h1>
          <p style="font-size:11px;color:rgba(233,213,255,0.85);font-weight:700;margin:2px 0 0;text-transform:uppercase;letter-spacing:0.05em;">Comisiones y Liquidaciones Mensuales</p>
        </div>
      </div>

      <!-- Main Content Scroll Area -->
      <div id="paulos-admin-scroll" style="flex:1; overflow-y:auto; padding:20px; display:flex; flex-direction:column; gap:20px; -webkit-overflow-scrolling:touch;">
        <div style="text-align:center; padding:32px; color:var(--color-text-secondary); font-weight:700;">
          Cargando datos del convenio...
        </div>
      </div>
    </div>
  `;

  await loadKioskPaulosData();
}

async function loadKioskPaulosData() {
  const scrollArea = document.getElementById('paulos-admin-scroll');
  if (!scrollArea) return;

  try {
    // Ensure Maxikiosco Paulos commerce exists in 'comercios' collection
    const { setDoc } = await import('firebase/firestore');
    const paulosComRef = doc(db, 'comercios', 'maxikiosco_paulos');
    const paulosComSnap = await getDoc(paulosComRef);
    if (!paulosComSnap.exists()) {
      await setDoc(paulosComRef, {
        name: 'Maxikiosco Paulos',
        category: 'Kiosco',
        description: 'Convenio oficial con Maxikiosco Paulos',
        deliveryCost: 0,
        deliveryTime: 25,
        phone: '5492215555555',
        address: 'Magdalena',
        coords: { lat: -35.0811, lng: -57.5146 },
        ownerId: 'paulos_preset',
        isActive: true,
        approvedByAdmin: true,
        promoted: false, // Publicidad/destaque desactivado
        createdAt: new Date()
      });
    }

    // 1. Fetch Configuration
    const configDocRef = doc(db, 'settings', 'paulos_config');
    const configSnap = await getDoc(configDocRef);
    const config = configSnap.exists() ? configSnap.data() : {
      enabled: true,
      commissionPercent: 10, // % commission on total sales
      whatsappNumber: '5492215555555'
    };

    // 2. Fetch Delivered Favor Orders related to Paulos
    const ordersQuery = query(
      collection(db, 'orders'),
      where('status', 'in', ['delivered', 'completed'])
    );
    const querySnap = await getDocs(ordersQuery);

    const allPaulosOrders = [];
    querySnap.forEach(docSnap => {
      const data = docSnap.data();
      const isPaulos = data.isPaulosPreset || 
                       (data.storeName && data.storeName.toLowerCase().includes('paulos')) ||
                       (data.details && data.details.toLowerCase().includes('paulos')) ||
                       (data.favorType === 'compra' && data.stores && JSON.stringify(data.stores).toLowerCase().includes('paulos'));
      
      if (isPaulos) {
        allPaulosOrders.push({ id: docSnap.id, ...data });
      }
    });

    // Sort by createdAt desc
    allPaulosOrders.sort((a, b) => {
      const tA = a.createdAt?.seconds || 0;
      const tB = b.createdAt?.seconds || 0;
      return tB - tA;
    });

    // Filter by selected month
    const filteredOrders = allPaulosOrders.filter(o => {
      if (!currentSelectedMonth) return true;
      if (!o.createdAt?.seconds) return true;
      const orderMonth = new Date(o.createdAt.seconds * 1000).toISOString().slice(0, 7);
      return orderMonth === currentSelectedMonth;
    });

    const pendingOrders = filteredOrders.filter(o => !o.settled);

    // Calculate total sales and total commission debt for the period
    let periodTotalSales = 0;
    let periodPendingCommission = 0;

    filteredOrders.forEach(o => {
      const salesAmount = o.subtotal || o.productsTotal || o.purchaseAmount || o.total || 0;
      periodTotalSales += salesAmount;

      if (!o.settled) {
        const orderCommPercent = config.commissionPercent ?? 10;
        const commAmount = Math.round(salesAmount * (orderCommPercent / 100));
        periodPendingCommission += commAmount;
      }
    });

    scrollArea.innerHTML = `
      <!-- Config Section Card -->
      <div style="background:var(--color-surface); border:1px solid var(--color-border); border-radius:24px; padding:20px; display:flex; flex-direction:column; gap:16px; box-shadow:var(--shadow-sm);">
        <div style="display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid var(--color-border-light); padding-bottom:12px;">
          <div style="display:flex; align-items:center; gap:10px;">
            <div style="width:36px; height:36px; border-radius:10px; background:rgba(124,58,237,0.1); color:#7c3aed; display:flex; align-items:center; justify-content:center;">
              ${icon('settings', 18)}
            </div>
            <span style="font-family:var(--font-display); font-size:15px; font-weight:900; color:var(--color-text-primary);">Configuración de Comisión %</span>
          </div>
          
          <!-- Toggle Switch -->
          <label style="display:inline-flex; align-items:center; gap:8px; cursor:pointer;">
            <span style="font-size:12px; font-weight:800; color:${config.enabled !== false ? '#059669' : 'var(--color-text-tertiary)'};">
              ${config.enabled !== false ? 'ACTIVO' : 'PAUSADO'}
            </span>
            <input type="checkbox" id="paulos-enabled-toggle" ${config.enabled !== false ? 'checked' : ''} style="width:20px; height:20px; accent-color:#7c3aed; cursor:pointer;" />
          </label>
        </div>

        <form id="paulos-config-form" style="display:flex; flex-direction:column; gap:14px;">
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
            <div style="display:flex; flex-direction:column; gap:4px;">
              <label style="font-size:11px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase;">Comisión (%)</label>
              <input type="number" id="paulos-comm-input" value="${config.commissionPercent ?? 10}" min="0" max="100" step="0.5" style="height:44px; border-radius:12px; border:1.5px solid var(--color-border); padding:0 12px; background:var(--color-bg); font-weight:800; color:var(--color-text-primary);" required />
            </div>
            <div style="display:flex; flex-direction:column; gap:4px;">
              <label style="font-size:11px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase;">Filtrar Mes</label>
              <input type="month" id="paulos-month-input" value="${currentSelectedMonth}" style="height:44px; border-radius:12px; border:1.5px solid var(--color-border); padding:0 12px; background:var(--color-bg); font-weight:800; color:var(--color-text-primary);" />
            </div>
          </div>

          <div style="display:flex; flex-direction:column; gap:4px;">
            <label style="font-size:11px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase;">WhatsApp del Comercio (para enviar reporte)</label>
            <input type="text" id="paulos-phone-input" value="${config.whatsappNumber || '5492215555555'}" placeholder="Ej: 549221XXXXXXX" style="height:44px; border-radius:12px; border:1.5px solid var(--color-border); padding:0 12px; background:var(--color-bg); font-weight:800; color:var(--color-text-primary);" required />
          </div>

          <button type="submit" style="height:46px; border-radius:14px; background:linear-gradient(135deg,#7c3aed,#6d28d9); color:white; border:none; font-weight:900; font-size:13.5px; cursor:pointer; box-shadow:0 4px 12px rgba(124,58,237,0.3); text-transform:uppercase;">
            Guardar Configuración
          </button>
        </form>
      </div>

      <!-- Debt & Settlement Summary Card -->
      <div style="background: linear-gradient(135deg, #1e1b4b 0%, #311b92 100%); border-radius:24px; padding:22px; color:white; display:flex; flex-direction:column; gap:16px; box-shadow:0 8px 24px rgba(49,27,146,0.3); position:relative; overflow:visible; min-height:140px; box-sizing:border-box;">
        <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:10px;">
          <div style="display:flex; flex-direction:column; min-width:0;">
            <span style="font-size:11px; font-weight:800; color:rgba(233,213,255,0.85); text-transform:uppercase; letter-spacing:0.05em; white-space:nowrap;">Ganancia Pendiente (${config.commissionPercent ?? 10}%)</span>
            <span style="font-size:26px; font-weight:950; color:#fbbf24; margin-top:4px; font-family:var(--font-display); line-height:1.2;">${formatPrice(periodPendingCommission)}</span>
          </div>
          <div style="text-align:right; flex-shrink:0;">
            <span style="font-size:11px; font-weight:800; color:rgba(233,213,255,0.85); text-transform:uppercase; display:block;">Ventas del Mes</span>
            <span style="display:block; font-size:19px; font-weight:900; color:white; margin-top:2px;">${formatPrice(periodTotalSales)}</span>
          </div>
        </div>

        <button id="btn-settle-paulos" ${pendingOrders.length === 0 ? 'disabled' : ''} style="height:50px; border-radius:16px; background:${pendingOrders.length > 0 ? 'linear-gradient(135deg,#f59e0b,#d97706)' : 'rgba(255,255,255,0.2)'}; color:white; border:none; font-size:13.5px; font-weight:950; cursor:${pendingOrders.length > 0 ? 'pointer' : 'not-allowed'}; display:flex; align-items:center; justify-content:center; gap:10px; text-transform:uppercase; letter-spacing:0.05em; box-shadow:${pendingOrders.length > 0 ? '0 6px 16px rgba(245,158,11,0.4)' : 'none'}; flex-shrink:0;">
          ${icon('checkCircle', 20)} Liquidar Cuota a $0 (${pendingOrders.length} pendientes)
        </button>
      </div>

      <!-- Orders History Section -->
      <div style="display:flex; flex-direction:column; gap:12px;">
        <div style="display:flex; align-items:center; justify-content:space-between; padding:0 4px;">
          <h3 style="font-family:var(--font-display); font-size:16px; font-weight:900; color:var(--color-text-primary); margin:0;">Historial de Entregas del Período</h3>
          <span style="font-size:11.5px; font-weight:700; color:var(--color-text-tertiary);">${filteredOrders.length} registros</span>
        </div>

        ${filteredOrders.length === 0 ? `
          <div style="background:var(--color-surface); border:1px solid var(--color-border); border-radius:20px; padding:32px; text-align:center; color:var(--color-text-secondary); font-weight:700;">
            No hay registros de mandados o compras en Paulos en el período seleccionado.
          </div>
        ` : `
          <div style="display:flex; flex-direction:column; gap:10px;">
            ${filteredOrders.map(o => {
              const salesAmount = o.subtotal || o.productsTotal || o.purchaseAmount || o.total || 0;
              const orderCommPercent = config.commissionPercent ?? 10;
              const commAmount = Math.round(salesAmount * (orderCommPercent / 100));
              const dateStr = o.createdAt ? new Date(o.createdAt.seconds * 1000).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'Reciente';

              return `
                <div style="background:var(--color-surface); border:1px solid ${o.settled ? 'var(--color-border-light)' : 'rgba(245,158,11,0.4)'}; border-radius:18px; padding:14px 16px; display:flex; flex-direction:column; gap:8px; box-shadow:var(--shadow-sm);">
                  <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
                    <div style="display:flex; align-items:center; gap:8px; min-width:0;">
                      <span style="font-size:12px; font-weight:900; color:var(--color-text-primary);">#${o.id.slice(-6).toUpperCase()}</span>
                      <span style="font-size:11px; font-weight:700; color:var(--color-text-tertiary);">${dateStr}</span>
                    </div>
                    <span style="font-size:10px; font-weight:900; padding:3px 8px; border-radius:6px; text-transform:uppercase; flex-shrink:0; ${o.settled ? 'background:rgba(16,185,129,0.1); color:#10b981;' : 'background:rgba(245,158,11,0.15); color:#d97706;'}">
                      ${o.settled ? 'LIQUIDADO' : 'PENDIENTE'}
                    </span>
                  </div>

                  <div style="font-size:12.5px; font-weight:700; color:var(--color-text-primary);">
                    👤 Cliente: <span style="font-weight:600; color:var(--color-text-secondary);">${o.userName || o.clientName || 'Cliente'}</span>
                  </div>

                  <div style="font-size:12px; color:var(--color-text-secondary); font-weight:600; background:var(--color-bg-secondary); padding:8px 10px; border-radius:10px; border:1px solid var(--color-border-light);">
                    📦 <span style="font-weight:700; color:var(--color-text-primary);">Detalle:</span> ${o.details || (o.stores && o.stores[0]?.details) || 'Compra Maxikiosco Paulos'}
                  </div>

                  <div style="display:flex; align-items:center; justify-content:space-between; padding-top:6px; border-top:1px dashed var(--color-border-light); font-size:12px; font-weight:800;">
                    <span style="color:var(--color-text-secondary);">Venta Total: <strong style="color:var(--color-text-primary);">${formatPrice(salesAmount)}</strong></span>
                    <span style="color:var(--color-text-secondary);">Comisión (${orderCommPercent}%): <strong style="color:${o.settled ? '#059669' : '#d97706'}; font-size:13.5px;">${formatPrice(commAmount)}</strong></span>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        `}
      </div>
    `;

    // Month Selector change event
    const monthInput = scrollArea.querySelector('#paulos-month-input');
    if (monthInput) {
      monthInput.onchange = async () => {
        currentSelectedMonth = monthInput.value;
        await loadKioskPaulosData();
      };
    }

    // 3. Attach Form Submit Event
    const configForm = scrollArea.querySelector('#paulos-config-form');
    if (configForm) {
      configForm.onsubmit = async (e) => {
        e.preventDefault();
        const commissionPercent = Number(document.getElementById('paulos-comm-input').value) ?? 10;
        const whatsappNumber = document.getElementById('paulos-phone-input').value.trim() || '5492215555555';
        const enabled = document.getElementById('paulos-enabled-toggle').checked;
        currentSelectedMonth = document.getElementById('paulos-month-input').value;

        await setDoc(configDocRef, {
          enabled,
          commissionPercent,
          whatsappNumber,
          updatedAt: serverTimestamp()
        }, { merge: true });

        showToast('✅ Configuración de comisión guardada con éxito', 'success');
        await loadKioskPaulosData();
      };
    }

    // 4. Attach Settlement Button Event
    const settleBtn = scrollArea.querySelector('#btn-settle-paulos');
    if (settleBtn && pendingOrders.length > 0) {
      settleBtn.onclick = () => {
        showConfirm({
          title: 'Liquidar Cuota Mensual de Paulos',
          message: `¿Confirmas liquidar las ganancias del período por <strong>${formatPrice(periodPendingCommission)}</strong> correspondientes a ${pendingOrders.length} entregas exitosas?<br><br>El saldo pasará a $0 y se generará el Excel y el WhatsApp automático.`,
          confirmText: 'Sí, Liquidar a $0',
          cancelText: 'Cancelar',
          onConfirm: async () => {
            await executeSettlement(pendingOrders, periodPendingCommission, config);
          }
        });
      };
    }

  } catch (err) {
    console.error('Error loading Paulos admin data:', err);
    scrollArea.innerHTML = `<div class="empty-state"><p>Error al cargar los datos: ${err.message}</p></div>`;
  }
}

async function executeSettlement(pendingOrders, totalCommission, config) {
  try {
    const batch = writeBatch(db);

    pendingOrders.forEach(o => {
      const orderRef = doc(db, 'favor_orders', o.id);
      batch.update(orderRef, {
        settled: true,
        settledAt: serverTimestamp()
      });
    });

    await batch.commit();

    // Generate CSV Excel File
    generateExcelCSVReport(pendingOrders, totalCommission, config);

    // Generate Printable PDF Report
    generatePDFReport(pendingOrders, totalCommission, config);

    // Build WhatsApp message breakdown
    const phone = config.whatsappNumber || '5492215555555';
    let msg = `🧾 *LIQUIDACIÓN DE CUOTA CONVENIO - GODELIVERY*\n`;
    msg += `🏪 *Comercio:* Maxikiosco Paulos\n`;
    msg += `📅 *Período:* ${currentSelectedMonth}\n`;
    msg += `📦 *Ventas Entregadas:* ${pendingOrders.length} pedidos\n`;
    msg += `-----------------------------------\n`;

    let totalVentasPeriodo = 0;
    pendingOrders.forEach((o, idx) => {
      const salesAmount = o.subtotal || o.productsTotal || o.purchaseAmount || o.total || 0;
      totalVentasPeriodo += salesAmount;
      const orderCommPercent = config.commissionPercent ?? 10;
      const commAmount = Math.round(salesAmount * (orderCommPercent / 100));
      const details = o.details || (o.stores && o.stores[0]?.details) || 'Compra Kiosco';

      msg += `${idx + 1}. #${o.id.slice(-6).toUpperCase()} | Venta: $${salesAmount} | Comisión (${orderCommPercent}%): $${commAmount}\n`;
    });

    msg += `-----------------------------------\n`;
    msg += `💵 *TOTAL VENTAS CONCRETADAS:* *${formatPrice(totalVentasPeriodo)}*\n`;
    msg += `💰 *TOTAL COMISIÓN A PAGAR:* *${formatPrice(totalCommission)}*\n\n`;
    msg += `*(Se ha generado el PDF y el archivo Excel con todas las ventas del período)*`;

    const encodedMsg = encodeURIComponent(msg);
    const waUrl = `https://wa.me/${phone.replace(/[^0-9]/g, '')}?text=${encodedMsg}`;

    showToast('🎉 Liquidación realizada con éxito. PDF y Excel generados.', 'success');

    // Automatically open WhatsApp in new window/app
    window.open(waUrl, '_blank');

    // Reload panel view
    await loadKioskPaulosData();

  } catch (err) {
    console.error('Error during settlement execution:', err);
    showToast('Error al liquidar: ' + err.message, 'error');
  }
}

function generateExcelCSVReport(orders, totalCommission, config) {
  let csvContent = 'ID Pedido,Fecha,Cliente,Detalle Pedido,Monto Venta ($),Comision (%),Monto Comision A Pagar ($)\n';

  let totalVentasSum = 0;
  orders.forEach(o => {
    const salesAmount = o.subtotal || o.productsTotal || o.purchaseAmount || o.total || 0;
    totalVentasSum += salesAmount;
    const orderCommPercent = config.commissionPercent ?? 10;
    const commAmount = Math.round(salesAmount * (orderCommPercent / 100));
    const dateStr = o.createdAt ? new Date(o.createdAt.seconds * 1000).toLocaleString('es-AR') : 'Reciente';
    const clientName = (o.userName || o.clientName || 'Cliente').replace(/,/g, ' ');
    const details = (o.details || (o.stores && o.stores[0]?.details) || 'Compra Kiosco').replace(/,/g, ' ').replace(/\n/g, ' ');

    csvContent += `"#${o.id.slice(-6).toUpperCase()}","${dateStr}","${clientName}","${details}","$${salesAmount}","${orderCommPercent}%","$${commAmount}"\n`;
  });

  csvContent += `\n,,,,TOTAL VENTAS:,"$${totalVentasSum}",\n`;
  csvContent += `,,,,,TOTAL COMISION A PAGAR:,"$${totalCommission}"\n`;

  const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `Liquidacion_Paulos_${currentSelectedMonth}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function generatePDFReport(orders, totalCommission, config) {
  let totalVentasSum = 0;
  const rowsHtml = orders.map((o, idx) => {
    const salesAmount = o.subtotal || o.productsTotal || o.purchaseAmount || o.total || 0;
    totalVentasSum += salesAmount;
    const orderCommPercent = config.commissionPercent ?? 10;
    const commAmount = Math.round(salesAmount * (orderCommPercent / 100));
    const dateStr = o.createdAt ? new Date(o.createdAt.seconds * 1000).toLocaleString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }) : 'Reciente';
    const clientName = o.userName || o.clientName || 'Cliente';
    const details = o.details || (o.stores && o.stores[0]?.details) || 'Compra Kiosco';

    return `
      <tr style="border-bottom: 1px solid #e2e8f0; font-size: 11px;">
        <td style="padding: 8px 10px; font-weight: bold; color: #475569;">#${o.id.slice(-6).toUpperCase()}</td>
        <td style="padding: 8px 10px; color: #64748b;">${dateStr}</td>
        <td style="padding: 8px 10px; color: #334155; font-weight: 600;">${clientName}</td>
        <td style="padding: 8px 10px; color: #334155;">${details}</td>
        <td style="padding: 8px 10px; text-align: right; font-weight: 700; color: #0f172a;">$ ${salesAmount.toLocaleString('es-AR')}</td>
        <td style="padding: 8px 10px; text-align: center; color: #64748b;">${orderCommPercent}%</td>
        <td style="padding: 8px 10px; text-align: right; font-weight: 800; color: #7c3aed;">$ ${commAmount.toLocaleString('es-AR')}</td>
      </tr>
    `;
  }).join('');

  const html = `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8" />
      <title>Liquidación Maxikiosco Paulos - ${currentSelectedMonth}</title>
      <style>
        @page { size: A4; margin: 15mm; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1e293b; margin: 0; padding: 20px; background: #fff; }
        .header { display: flex; align-items: center; justify-content: space-between; border-bottom: 2px solid #7c3aed; padding-bottom: 16px; margin-bottom: 20px; }
        .title-box { display: flex; align-items: center; gap: 14px; }
        .logo-img { width: 50px; height: 50px; border-radius: 50%; object-fit: cover; border: 2px solid #7c3aed; }
        h1 { margin: 0; font-size: 20px; color: #2e1065; font-weight: 900; }
        p { margin: 2px 0 0; font-size: 12px; color: #64748b; font-weight: 600; }
        .badge { background: #f3e8ff; color: #7c3aed; font-weight: 800; font-size: 11px; padding: 6px 12px; border-radius: 8px; text-transform: uppercase; border: 1px solid #d8b4fe; }
        .summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 24px; }
        .card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px 16px; }
        .card-label { font-size: 10px; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; }
        .card-val { font-size: 20px; font-weight: 900; color: #0f172a; margin-top: 4px; }
        .card-val-purple { font-size: 22px; font-weight: 950; color: #7c3aed; margin-top: 4px; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
        th { background: #7c3aed; color: #ffffff; font-size: 10.5px; font-weight: 800; text-transform: uppercase; padding: 10px; text-align: left; }
        th.right { text-align: right; }
        th.center { text-align: center; }
        .footer-total { display: flex; justify-content: flex-end; gap: 20px; padding-top: 14px; border-top: 2px solid #7c3aed; margin-top: 20px; }
        .total-box { text-align: right; }
        .total-label { font-size: 11px; font-weight: 800; color: #64748b; text-transform: uppercase; }
        .total-amount { font-size: 24px; font-weight: 950; color: #7c3aed; }
        @media print {
          body { padding: 0; }
        }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="title-box">
          <img src="/paulos-logo-real.jpg?v=9" class="logo-img" alt="Paulos" />
          <div>
            <h1>Liquidación de Convenio - GoDelivery</h1>
            <p>Comercio: Maxikiosco Paulos | Chacabuco 451, Magdalena</p>
          </div>
        </div>
        <div class="badge">Período: ${currentSelectedMonth}</div>
      </div>

      <div class="summary-grid">
        <div class="card">
          <div class="card-label">Ventas Entregadas</div>
          <div class="card-val">${orders.length} pedidos</div>
        </div>
        <div class="card">
          <div class="card-label">Total Ventas Concretadas</div>
          <div class="card-val">$ ${totalVentasSum.toLocaleString('es-AR')}</div>
        </div>
        <div class="card">
          <div class="card-label">Comisión A Comisionar (${config.commissionPercent ?? 10}%)</div>
          <div class="card-val-purple">$ ${totalCommission.toLocaleString('es-AR')}</div>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>Pedido</th>
            <th>Fecha</th>
            <th>Cliente</th>
            <th>Detalle</th>
            <th class="right">Venta ($)</th>
            <th class="center">Comisión %</th>
            <th class="right">Monto Comisión ($)</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>

      <div class="footer-total">
        <div class="total-box">
          <div class="total-label">Total Comisión A Abonar por el Comercio</div>
          <div class="total-amount">$ ${totalCommission.toLocaleString('es-AR')}</div>
        </div>
      </div>
    </body>
    </html>
  `;

  const printWindow = window.open('', '_blank');
  if (printWindow) {
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    printWindow.setTimeout(() => {
      printWindow.print();
    }, 300);
  }
}
