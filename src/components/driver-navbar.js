// Fixed bottom tab bar for the driver/delivery panel (Track B, Fase 2).
// Pure render function — the shell (delivery-panel.js) owns tab state and wires clicks,
// same pattern as renderStatusBar/attachStatusBarListeners.
import { icon } from '../utils/icons.js';

// Nav bar's own height in px (excludes safe-area inset, which is added on top via CSS env()).
// Shared with delivery-panel.js so the dock, offline hero and HUD pill positions can reserve
// space above the bar instead of being covered by it.
export const DRIVER_NAV_BAR_HEIGHT = 58;

// "Pedidos" and "Mapa" used to be separate tabs, but they showed the same background
// map with only a small status card as the difference — genuinely redundant. Merged
// into one "Inicio" home tab; the searching-status card and the map now just coexist
// there, same as the reference apps (Uber Driver etc. don't split these either).
export const DRIVER_NAV_TABS = [
  { id: 'available', label: 'Inicio', icon: 'home' },
  { id: 'finances', label: 'Ganancias', icon: 'wallet' },
  { id: 'perfil', label: 'Perfil', icon: 'user' }
];

// Every internal content state that isn't its own tab (the searching overlay, the
// auto-triggered active-order tracking view, ...) rolls up to "Inicio" for highlight
// purposes — they all live on the same home destination now.
export function driverNavTabForActiveTab(activeTab) {
  if (activeTab === 'finances' || activeTab === 'perfil') return activeTab;
  return 'available';
}

export function renderDriverBottomNav(activeTab, isLight) {
  const effective = driverNavTabForActiveTab(activeTab);
  const bg = isLight ? '#ffffff' : '#090d16';
  const border = isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.08)';
  const shadow = isLight ? 'rgba(0,0,0,0.06)' : 'rgba(0,0,0,0.5)';
  const inactiveColor = isLight ? '#94a3b8' : '#64748b';

  return `
    <div id="driver-bottom-nav" style="
      position: fixed; left: 0; right: 0; bottom: 0;
      display: flex; align-items: stretch;
      height: calc(${DRIVER_NAV_BAR_HEIGHT}px + env(safe-area-inset-bottom, 0px));
      padding-bottom: env(safe-area-inset-bottom, 0px);
      background: ${bg};
      border-top: 1px solid ${border};
      box-shadow: 0 -4px 20px ${shadow};
      z-index: 9990;
      pointer-events: auto;
    ">
      ${DRIVER_NAV_TABS.map(t => {
        const isActive = t.id === effective;
        const color = isActive ? '#e11d48' : inactiveColor;
        return `
        <button type="button" class="driver-nav-tab-btn" data-nav-tab="${t.id}" aria-label="${t.label}" style="
          flex: 1;
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          gap: 3px;
          background: transparent; border: none; cursor: pointer;
          color: ${color};
          padding: 6px 0 2px 0;
          -webkit-tap-highlight-color: transparent;
        ">
          <span style="display:inline-flex;">${icon(t.icon, 22)}</span>
          <span style="font-size: 10.5px; font-weight: ${isActive ? 800 : 700};">${t.label}</span>
        </button>`;
      }).join('')}
    </div>
  `;
}

export function updateDriverBottomNavUI(activeTab) {
  const effective = driverNavTabForActiveTab(activeTab);
  document.querySelectorAll('.driver-nav-tab-btn').forEach(btn => {
    const isActive = btn.dataset.navTab === effective;
    const isLight = document.getElementById('driver-bottom-nav')?.style.background === 'rgb(255, 255, 255)';
    btn.style.color = isActive ? '#e11d48' : (isLight ? '#94a3b8' : '#64748b');
    const label = btn.querySelector('span:last-child');
    if (label) label.style.fontWeight = isActive ? '800' : '700';
  });
}
