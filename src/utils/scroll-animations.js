/**
 * GoDelivery — Scroll Reveal Animations Engine
 * Uses IntersectionObserver for triggering animations and MutationObserver
 * to automatically observe elements dynamically loaded (e.g. from Firebase).
 */

const observerOptions = {
  root: null, // use viewport
  rootMargin: '0px 0px -80px 0px', // trigger 80px inside the viewport for highly visible feedback when scrolling
  threshold: 0.05 // trigger when at least 5% of the element is visible
};

let revealObserver = null;
let mutationObserver = null;

/**
 * Initializes the IntersectionObserver and starts observing existing elements.
 */
export function initScrollAnimations() {
  if (revealObserver) return; // Already initialized

  revealObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      // CRITICAL: Prevent elements in hidden containers (display: none) from being immediately triggered.
      // Hidden elements have a height/width of 0. We only animate them if they are intersecting AND have size.
      const isVisible = entry.boundingClientRect && entry.boundingClientRect.height > 0;
      
      if (entry.isIntersecting && isVisible) {
        entry.target.classList.add('revealed');
      } else if (!entry.isIntersecting) {
        // Remove class when out of view so it animates again when scrolling back
        entry.target.classList.remove('revealed');
      }
    });
  }, observerOptions);

  // 1. Observe existing elements in DOM
  const existingElements = document.querySelectorAll('.scroll-reveal');
  existingElements.forEach(el => revealObserver.observe(el));

  // 2. Setup MutationObserver to watch for dynamic content additions
  mutationObserver = new MutationObserver((mutations) => {
    let hasAdditions = false;
    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        if (mutation.addedNodes.length > 0) {
          hasAdditions = true;
        }
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            // Check if the added node itself is scroll-reveal
            if (node.classList.contains('scroll-reveal')) {
              revealObserver.observe(node);
            }
            // Check if it has scroll-reveal descendants
            const descendants = node.querySelectorAll('.scroll-reveal');
            descendants.forEach(el => revealObserver.observe(el));
          }
        });
      }
    }
    if (hasAdditions) {
      // Re-observe unrevealed elements to force IntersectionObserver to evaluate them with their new dimensions
      const unrevealed = document.querySelectorAll('.scroll-reveal:not(.revealed)');
      unrevealed.forEach(el => {
        revealObserver.unobserve(el);
        revealObserver.observe(el);
      });
    }
  });

  // Start observing document body for changes
  mutationObserver.observe(document.body, {
    childList: true,
    subtree: true
  });

  // 3. Robust scroll capture fallback
  // Since panels (like .slide-panel or #app-overlay) scroll instead of window body,
  // we listen to scroll events in the capture phase to force-trigger intersection updates.
  window.addEventListener('scroll', () => {
    scanAndObserve();
  }, { capture: true, passive: true });

  // 4. Force check on hash/route change
  window.addEventListener('hashchange', () => {
    // Wait a brief moment for panels to become active (display: block) and layout to complete
    setTimeout(scanAndObserve, 50);
    setTimeout(scanAndObserve, 150);
    setTimeout(scanAndObserve, 350);
  });

  console.log('GoDelivery: Scroll Reveal Animations Engine active.');
}

/**
 * Forces manual re-scan and observation of the container.
 * Useful if MutationObserver misses a shadow DOM or template insertion (rare).
 * @param {HTMLElement} container 
 */
export function scanAndObserve(container = document.body) {
  if (!revealObserver) return;
  const elements = container.querySelectorAll('.scroll-reveal');
  elements.forEach(el => {
    revealObserver.observe(el);
  });
}
