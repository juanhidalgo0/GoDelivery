export function printComanda(order) {
  const iframe = document.createElement('iframe');
  iframe.style.display = 'none';
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow.document;
  
  const formatP = (num) => '$' + (num || 0).toLocaleString('es-AR');
  const d = order.createdAt ? (order.createdAt.toDate ? order.createdAt.toDate() : new Date(order.createdAt)) : new Date();
  
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>Comanda #${order.orderId || 'S/N'}</title>
        <style>
          @page { margin: 0; }
          html, body { height: 100vh; margin: 0; padding: 0; }
          body { font-family: 'Courier New', Courier, monospace; width: 100%; display: flex; flex-direction: column; box-sizing: border-box; padding: 20px; font-size: 16px; color: #000; background: #fff; }
          .content-wrapper { flex: 1; }
          .footer-wrapper { margin-top: auto; }
          .header { text-align: center; margin-bottom: 20px; border-bottom: 2px dashed #000; padding-bottom: 15px; }
          .title { font-size: 28px; font-weight: bold; margin-bottom: 5px; text-transform: uppercase; }
          .subtitle { font-size: 20px; font-weight: bold; margin-bottom: 5px; }
          .date { font-size: 16px; }
          .section { margin-bottom: 20px; border-bottom: 2px dashed #000; padding-bottom: 15px; }
          .section-title { font-weight: bold; font-size: 18px; margin-bottom: 10px; text-decoration: underline; }
          .row { margin-bottom: 6px; }
          .item { display: flex; justify-content: space-between; margin-bottom: 8px; align-items: flex-start; }
          .item-qty { font-weight: bold; margin-right: 10px; min-width: 24px; }
          .item-name { flex: 1; font-weight: bold; text-transform: uppercase; }
          .item-price { margin-left: 15px; text-align: right; }
          .totals { margin-top: 15px; }
          .total-row { display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 16px; }
          .total-final { display: flex; justify-content: space-between; font-weight: bold; font-size: 24px; margin-top: 12px; border-top: 2px solid #000; padding-top: 12px; }
          .footer { text-align: center; font-size: 14px; margin-top: 30px; padding-top: 15px; }
          * { box-sizing: border-box; }
        </style>
      </head>
      <body>
        <div class="content-wrapper">
          <div class="header">
            <div class="title">${order.comercioName || 'Comercio'}</div>
            <div class="subtitle">PEDIDO #${order.orderId || 'S/N'}</div>
            <div class="date">${d.toLocaleDateString('es-AR')} - ${d.toLocaleTimeString('es-AR', {hour: '2-digit', minute:'2-digit'})}</div>
          </div>
          
          <div class="section">
            <div class="row"><strong>Cliente:</strong> ${order.userName || 'Consumidor Final'}</div>
            <div class="row"><strong>Teléfono:</strong> ${order.userPhone || '---'}</div>
            <div class="row">
              <strong>Modalidad:</strong> ${order.deliveryAddress ? 'DELIVERY' : 'RETIRO EN LOCAL'}
            </div>
            ${order.deliveryAddress ? `<div class="row"><strong>Dirección:</strong> ${order.deliveryAddress}</div>` : ''}
          </div>

          <div class="section">
            <div class="section-title">DETALLE</div>
            ${(order.items || []).map(i => `
              <div class="item">
                <div class="item-qty">${i.qty}x</div>
                <div class="item-name">${i.name}</div>
                <div class="item-price">${formatP(i.price * i.qty)}</div>
              </div>
            `).join('')}
          </div>
        </div>

        <div class="footer-wrapper">

        <div class="section totals">
          <div class="total-row">
            <span>Subtotal</span>
            <span>${formatP(order.subtotal || order.total - (order.deliveryCost || 0))}</span>
          </div>
          ${order.deliveryCost ? `
          <div class="total-row">
            <span>Costo de Envío</span>
            <span>${formatP(order.deliveryCost)}</span>
          </div>` : ''}
          <div class="total-final">
            <span>TOTAL</span>
            <span>${formatP(order.total)}</span>
          </div>
        </div>

        <div class="footer">
          <strong>*** TICKET NO FISCAL ***</strong><br>
          Generado por GoDelivery
        </div>
      </body>
    </html>
  `;
  
  doc.open();
  doc.write(html);
  doc.close();

  iframe.onload = () => {
    iframe.contentWindow.focus();
    iframe.contentWindow.print();
    setTimeout(() => {
      document.body.removeChild(iframe);
    }, 5000); // Wait enough time for print dialog
  };
}
