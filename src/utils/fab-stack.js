/**
 * GoDelivery — FAB Stacking Manager
 * Ensures that floating action buttons don't overlap on mobile.
 */

export const FABStack = {
  reposition() {
    // Inject styles once
    if (!document.getElementById('global-fab-styles')) {
      const s = document.createElement('style');
      s.id = 'global-fab-styles';
      s.textContent = `
        #global-order-fab,
        #global-commerce-pending-fab,
        #global-active-delivery-fab,
        #global-delivery-available-fab {
          position: fixed !important;
          left: 0 !important;
          right: auto !important;
          padding: 8px 12px 8px 16px !important;
          border-radius: 0 30px 30px 0 !important;
          display: flex !important;
          align-items: center !important;
          color: white !important;
          cursor: pointer !important;
          z-index: 1450 !important;
          border: 2px solid white !important;
          border-left: none !important;
          font-family: var(--font-display) !important;
          font-weight: 800 !important;
          font-size: 13px !important;
          background: linear-gradient(135deg, #FF4757 0%, #E31B23 100%) !important;
          box-shadow: 4px 4px 20px rgba(227, 27, 35, 0.4) !important;
          transition: bottom 0.5s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.5s ease !important;
          transform: scale(1) translateY(0);
        }

        .fab-badge-content {
          display: flex !important;
          align-items: center !important;
          gap: 10px !important;
          max-width: 400px;
          opacity: 1;
          overflow: hidden;
          white-space: nowrap;
          transition: max-width 0.6s cubic-bezier(0.22, 1, 0.36, 1),
                      opacity 0.4s ease,
                      margin-right 0.6s cubic-bezier(0.22, 1, 0.36, 1) !important;
          margin-right: 12px !important;
        }

        #global-order-fab.collapsed .fab-badge-content,
        #global-commerce-pending-fab.collapsed .fab-badge-content,
        #global-active-delivery-fab.collapsed .fab-badge-content,
        #global-delivery-available-fab.collapsed .fab-badge-content {
          max-width: 0 !important;
          opacity: 0 !important;
          margin-right: 0 !important;
        }

        .fab-toggle-btn {
          width: 32px !important;
          height: 32px !important;
          background: white !important;
          border-radius: 50% !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          color: #E31B23 !important;
          box-shadow: 0 2px 8px rgba(0,0,0,0.15) !important;
          cursor: pointer !important;
          flex-shrink: 0 !important;
          transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275), background 0.3s ease !important;
        }

        .fab-toggle-btn:hover {
          transform: scale(1.08) !important;
        }

        @keyframes bell-ring {
          0%, 100% { transform: rotate(0); }
          15% { transform: rotate(15deg); }
          30% { transform: rotate(-15deg); }
          45% { transform: rotate(10deg); }
          60% { transform: rotate(-10deg); }
          75% { transform: rotate(4deg); }
          85% { transform: rotate(-4deg); }
        }

        .ringing-bell {
          animation: bell-ring 1.8s infinite both;
          transform-origin: top center;
          display: inline-block;
          font-size: 16px !important;
          line-height: 1 !important;
        }

        .arrow-icon {
          font-size: 16px !important;
          line-height: 1 !important;
          font-weight: 900 !important;
          display: inline-block;
        }
      `;
      document.head.appendChild(s);
    }

    const bottomBase = 70 + 20; // Above navbar
    const step = 68;
    let currentOffset = 0;

    // Order of importance (bottom to top)
    const fabs = [
      'global-order-fab',                  // Customer Active Order
      'global-active-delivery-fab',        // Delivery My Active Order
      'global-delivery-available-fab',     // Delivery Available Orders
      'global-commerce-pending-fab'        // Commerce Pending Orders
    ];

    fabs.forEach(id => {
      const el = document.getElementById(id);
      if (el && el.style.opacity !== '0') {
        el.style.bottom = `calc(${bottomBase + currentOffset}px + env(safe-area-inset-bottom, 0px))`;
        currentOffset += step;

        // Auto-wire toggle logic if not already done
        if (!el.dataset.toggleWired) {
          el.dataset.toggleWired = "true";
          el.classList.add('collapsed'); // Default to collapsed when shown

          // Capture phase click interceptor to seamlessly open the collapsed FAB
          el.addEventListener('click', (e) => {
            if (el.classList.contains('collapsed')) {
              e.stopPropagation();
              e.preventDefault();
              el.classList.remove('collapsed');
              if (el.updateToggleBtn) el.updateToggleBtn();
            }
          }, true);

          const wrapFAB = () => {
            if (el.querySelector('.fab-badge-content')) return;

            // Remove legacy dots if any
            const legacyDot = el.querySelector('.fab-toggle-dot');
            if (legacyDot) legacyDot.remove();

            const originalHTML = el.innerHTML;
            el.innerHTML = '';

            const badgeContent = document.createElement('div');
            badgeContent.className = 'fab-badge-content';
            badgeContent.innerHTML = originalHTML;

            const toggleBtn = document.createElement('div');
            toggleBtn.className = 'fab-toggle-btn';
            
            const updateBtn = () => {
              if (el.classList.contains('collapsed')) {
                toggleBtn.innerHTML = `
                  <svg viewBox="0 0 24 24" fill="currentColor" class="ringing-bell" style="width: 18px; height: 18px; display: inline-block;">
                    <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/>
                  </svg>
                `;
              } else {
                toggleBtn.innerHTML = `
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="arrow-icon" style="width: 15px; height: 15px; display: inline-block;">
                    <polyline points="15 18 9 12 15 6"/>
                  </svg>
                `;
              }
            };
            
            el.updateToggleBtn = updateBtn;
            updateBtn();

            el.appendChild(badgeContent);
            el.appendChild(toggleBtn);

            toggleBtn.onclick = (e) => {
              e.stopPropagation();
              el.classList.toggle('collapsed');
              updateBtn();
            };
          };

          wrapFAB();

          const observer = new MutationObserver(() => {
            observer.disconnect();
            wrapFAB();
            observer.observe(el, { childList: true });
          });
          observer.observe(el, { childList: true });
        }
      }
    });
  }
};
