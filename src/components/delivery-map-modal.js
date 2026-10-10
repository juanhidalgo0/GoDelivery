// GoDelivery — Delivery Map Modal Component (Unified Live Tracking UI)
import { showModal, closeModal } from './modal.js';
import { markReload } from '../utils/reload-log.js';

export function isOrderGeolocalizablePickup(o) {
  if (!o) return false;
  if (!o.isFavor) return true;
  const fType = o.favorType || o.type;
  if (fType === 'gocash') return false;
  if (fType === 'compra') return false;
  if (fType === 'pagodeservicios' && o.receiptDeliveryType === 'digital') return false;
  return true;
}

export function showDeliveryMapModal(order, batch = null) {
  if (order.status === 'completed' || order.status === 'cancelled') {
    import('./toast.js').then(m => m.showToast('Este pedido ya ha finalizado.', 'info'));
    return;
  }

  const modalContent = document.createElement('div');
  modalContent.style.width = '100%';
  modalContent.style.height = '100%';
  modalContent.style.background = 'var(--color-bg-secondary)';

  showModal({
    title: '',
    content: modalContent,
    hideHeader: true,
    fullscreen: true,
    onOpen: async () => {
      try {
        // One retry first: a second without signal also fails the import, and that used to
        // reload the whole app.
        const load = () => import('../pages/order-tracking.js');
        const { renderOrderTracking } = await load().catch(() => new Promise(r => setTimeout(r, 1200)).then(load));
        renderOrderTracking(order.id, modalContent, true, true);
      } catch (err) {
        console.error('Failed to load live tracking map module, forcing service worker reset & reload:', err);
        if (navigator.serviceWorker) {
          try {
            const regs = await navigator.serviceWorker.getRegistrations();
            for (let r of regs) {
              await r.unregister();
            }
          } catch (e) {}
        }
        markReload('no cargó el mapa de seguimiento');
        window.location.reload(true);
      }
    },
    onClose: () => {
      if (window.currentTrackingUnsub) {
        try { window.currentTrackingUnsub(); } catch(e) {}
        window.currentTrackingUnsub = null;
      }
    }
  });
}
