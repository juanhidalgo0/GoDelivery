// GoDelivery — SVG Icon System
// Centralized icon module replacing all emojis with professional SVG icons

const s = (d, vb = '0 0 24 24') => `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="${vb}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const sf = (d, vb = '0 0 24 24') => `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="${vb}" fill="currentColor">${d}</svg>`;

export const ICONS = {
  // Navigation
  home: s('<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>'),
  cart: s('<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>'),
  user: sf('<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/>'),

  search: s('<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>'),
  send: s('<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>'),
  smile: s('<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>'),
  chevronRight: s('<polyline points="9 18 15 12 9 6"/>'),
  chevronDown: s('<polyline points="6 9 12 15 18 9"/>'),
  menu: s('<line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/>'),
  navigationArrow: s('<polygon points="3 11 22 2 13 21 11 13 3 11"/>'),
  route: s('<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 1 0 0-7h-11a3.5 3.5 0 1 1 0-7H15"/><circle cx="18" cy="5" r="3"/>'),

  // Actions
  plus: s('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'),
  minus: s('<line x1="5" y1="12" x2="19" y2="12"/>'),
  close: s('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'),
  trash: s('<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'),
  edit: s('<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>'),
  check: s('<polyline points="20 6 9 17 4 12"/>'),
  filter: s('<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>'),
  upload: s('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>'),

  // Status
  checkCircle: s('<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>'),
  alertCircle: s('<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>'),
  alertTriangle: s('<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'),
  info: s('<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>'),
  xCircle: s('<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>'),

  // Commerce
  store: s('<path d="M3 9l1-4h16l1 4"/><path d="M3 9v11a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V9"/><path d="M9 21V9"/><path d="M3 9h18"/><rect x="13" y="13" width="6" height="4" rx="1"/>'),
  package: s('<line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>'),
  tag: s('<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>'),
  shoppingBag: s('<path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/>'),

  // Delivery
  truck: s('<rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>'),
  bike: s('<circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/>'),
  mapPin: s('<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>'),
  clock: s('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'),
  history: s('<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><polyline points="3 3 3 8 8 8"/><polyline points="12 7 12 12 15 15"/>'),

  // UI
  sun: s('<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>'),
  moon: s('<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>'),
  settings: s('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>'),
  shield: s('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>'),
  crown: s('<path d="M2 4l3 12h14l3-12-5 4-5-6-5 6-5-4z"/><line x1="3" y1="20" x2="21" y2="20"/>'),
  users: s('<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
  folder: s('<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>'),
  star: s('<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>'),
  heart: s('<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>'),
  logOut: s('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>'),
  award: s('<circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/>'),
  medal: s('<path d="M7.21 15 2.66 7.14a2 2 0 0 1 .13-2.2L4.4 2.8A2 2 0 0 1 6 2h12a2 2 0 0 1 1.6.8l1.6 2.14a2 2 0 0 1 .14 2.2L16.79 15"/><circle cx="12" cy="15" r="5"/><path d="M12 18v-6"/><path d="m9 15 3 3 3-3"/>'),
  phone: s('<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>'),
  zap: sf('<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>'),
  bank: s('<rect x="2" y="17" width="20" height="3" rx="1"/><path d="M7 17v-7"/><path d="M17 17v-7"/><path d="M12 17v-7"/><path d="M2 10l10-8 10 8"/>'),
  creditCard: s('<rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/>'),
  wallet: s('<path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4"/><path d="M4 6v12a2 2 0 0 0 2 2h14v-4"/><path d="M18 12a2 2 0 0 0-2 2c0 1.1.9 2 2 2h4v-4h-4z"/>'),
  grid: s('<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>'),
  bell: s('<path d="M10,21h4a2,2,0,0,1-4,0ZM21,17a1,1,0,0,1-1,1H4a1,1,0,0,1-1-1,1,1,0,0,1,1-1,5,5,0,0,0,4-4V9a4,4,0,0,1,8,0v4a5,5,0,0,0,4,4A1,1,0,0,1,21,17Z"/>'),
  caretLeft: s('<polyline points="15 18 9 12 15 6"/>'),
  caretDown: s('<polyline points="6 9 12 15 18 9"/>'),
  cloudRain: s('<path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="M16 14v6"/><path d="M8 14v6"/><path d="M12 16v6"/>'),
  copy: s('<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
  share: s('<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>'),
  gift: s('<polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/>'),

  eye: s('<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>'),
  whatsapp: sf('<path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>', '0 0 24 24'),
  whatsappLogo: sf('<path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>', '0 0 24 24'),

  // Chat & Messaging
  send: sf('<path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>'),
  camera: s('<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>'),
  image: s('<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>'),
  chatBubble: s('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
  chat: s('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
  dollarSign: s('<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>'),
  handPointing: s('<path d="M18 11V6a2 2 0 0 0-4 0v5"/><path d="M14 10V4a2 2 0 0 0-4 0v7"/><path d="M10 10.5V2a2 2 0 0 0-4 0v9"/><path d="M6 15v-2a2 2 0 0 0-4 0v6a8 8 0 0 0 16 0v-5a2 2 0 0 0-4 0"/><path d="M18 11a2 2 0 1 1 4 0v5"/>'),
  shieldCheck: s('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 12 15 16 10"/>'),
  loader: s('<line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/>'),
  chevronLeft: s('<polyline points="15 18 9 12 15 6"/>'),
  arrowLeft: s('<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>'),
  back: s('<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>'),
  readyBox: s('<path d="M21 8l-2-3H5L3 8"/><rect x="3" y="8" width="18" height="13" rx="1"/><path d="M10 12h4"/>'),

  // Category icons (cleaner, more professional paths)
  meat: s('<path d="M16 16c3.5 0 5-1.5 5-4.5S19.5 7 16 7h-1.5c-3 0-4.5 2-4.5 4.5s1.5 4.5 4.5 4.5H16z"/><path d="M7 14c-3 0-4.5 1.5-4.5 3s1.5 3 4.5 3"/><path d="M14 11a1 1 0 1 0 0-2 1 1 0 0 0 0 2z"/><path d="M17 11a1 1 0 1 0 0-2 1 1 0 0 0 0 2z"/>'),
  poultry: s('<path d="M18 2a4 4 0 0 0-4 4c0 3 3 3 3 6 0 3-4 5-4 5l-7 7"/><circle cx="4" cy="20" r="2"/><circle cx="2" cy="18" r="2"/>'),
  vegetable: s('<path d="M11 20c-3 0-6-3-6-6s3-6 6-6 6 3 6 6-3 6-6 6z"/><path d="M11 8V5c0-1 1-2 2-2s2 1 2 2v3"/><path d="M11 11c0-1.5 1.5-3 3-3"/>'),
  grocery: s('<path d="M3 6h18v14H3z"/><path d="M3 10h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M12 14v2"/><path d="M15 14v2"/>'),
  book: s('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>'),
  pharmacy: s('<path d="M4.8 4.8a7.07 7.07 0 0 0 0 10l5.66 5.66a7.07 7.07 0 0 0 10 0l-15.66-15.66z"/><path d="M13.5 13.5l5.66-5.66a7.07 7.07 0 0 0-10-10l-5.66 5.66"/><path d="M9 15l6-6"/>'),
  candy: s('<circle cx="12" cy="12" r="8"/><path d="M12 12l5.5-5.5"/><path d="M12 12l-5.5 5.5"/><path d="M12 12l5.5 5.5"/><path d="M12 12l-5.5-5.5"/>'),
  supermarket: s('<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>'),
  cheese: s('<path d="M12 3L2 7v10l10 4 10-4V7L12 3z"/><path d="M2 7l10 4 10-4"/><path d="M12 11v10"/><circle cx="7" cy="15" r="1"/><circle cx="17" cy="15" r="1"/>'),
  bread: s('<path d="M7 13c0-2 2-4 5-4s5 2 5 4"/><path d="M3 13h18a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2v-2a2 2 0 0 1 2-2z"/><path d="M7 13v-1"/><path d="M12 13v-1"/><path d="M17 13v-1"/>'),
  restaurant: s('<path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/>'),
  iceCream: s('<path d="M12 12c-2.5 0-4.5-2-4.5-4.5S9.5 3 12 3s4.5 2 4.5 4.5-2 4.5-4.5 4.5z"/><path d="M12 12l-4 8 4 2 4-2-4-8z"/>'),
  drink: s('<path d="M7 2h10l-2 20H9L7 2z"/><path d="M7 8h10"/><path d="M12 2v-1"/>'),
  all: s('<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>'),
  hardware: s('<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a2 2 0 0 1-2.83-2.83l-3.94 3.6z"/><path d="M14.7 6.3L4.3 16.7a2 2 0 0 0 0 2.8l1.6 1.6a2 2 0 0 0 2.8 0l10.4-10.4"/><path d="M18 4l2 2"/>'),
  vet: s('<path d="M12 15c3 0 5-2 5-5s-2-5-5-5-5 2-5 5 2 5 5 5z"/><path d="M12 15v3"/><path d="M10 18h4"/><path d="M12 8v4"/><path d="M10 10h4"/>'),
  electronics: s('<rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>'),
  pet: s('<path d="M12 13c-1 0-2-1-2-2s1-2 2-2 2 1 2 2-1 2-2 2z"/><path d="M12 18c-3 0-5-2-5-5s2-5 5-5 5 2 5 5-2 5-5 5z"/><path d="M18 10c1 0 2 1 2 2s-1 2-2 2-2-1-2-2 1-2 2-2z"/><path d="M6 10c1 0 2 1 2 2s-1 2-2 2-2-1-2-2 1-2 2-2z"/>'),

  // Misc
  rocket: s('<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>'),
  circle: sf('<circle cx="12" cy="12" r="10"/>'),
  circleActive: sf('<circle cx="12" cy="12" r="10" fill="#00D67F"/>'),
  circleInactive: sf('<circle cx="12" cy="12" r="10" fill="#FF4757"/>'),
  goPointsLogo: s('<circle cx="12" cy="12" r="10" stroke-width="2.5"/><path d="M15.5 8.5C14.5 7.5 13.3 7 12 7c-2.8 0-5 2.2-5 5s2.2 5 5 5c1.3 0 2.5-.5 3.5-1.5V12h-3.5" stroke-width="2.5"/>'),
  sparkles: s('<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.937A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .962 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.582a.5.5 0 0 1 0 .962L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.962 0L9.937 15.5z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/>'),
  target: s('<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/>'),
  trendingUp: s('<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>'),
  megaphone: s('<path d="M12 19H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h9M12 4l9 3v10l-9 3"/>'),
  percent: s('<line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>'),
};

// Category name to icon mapping
export const CATEGORY_ICON_MAP = {
  'Carnicería': 'meat',
  'Pollería': 'poultry',
  'Verdulería': 'vegetable',
  'Almacén': 'grocery',
  'Librería': 'book',
  'Farmacia': 'pharmacy',
  'Kiosco': 'candy',
  'Supermercado': 'supermarket',
  'Fiambrería': 'cheese',
  'Panadería': 'bread',
  'Restaurante': 'restaurant',
  'Heladería': 'iceCream',
  'Bebidas': 'drink',
  'Ferretería': 'hardware',
  'Veterinaria': 'vet',
  'Electrónica': 'electronics',
  'Mascotas': 'pet',
  'Todos': 'all',
  'GoMarket': 'shoppingBag',
};

// Premium Category Styles (Rappi / Uber Eats style colors)
export const CATEGORY_STYLES = {
  'Todos': { bg: '#FF4757', icon: '#FFFFFF', gradient: 'linear-gradient(135deg, #FF4757, #FF6B81)' },
  'Carnicería': { bg: '#8B0000', icon: '#FFFFFF', gradient: 'linear-gradient(135deg, #8B0000, #B22222)' },
  'Pollería': { bg: '#FFA500', icon: '#FFFFFF', gradient: 'linear-gradient(135deg, #FFA500, #FFD700)' },
  'Verdulería': { bg: '#2ECC71', icon: '#FFFFFF', gradient: 'linear-gradient(135deg, #2ECC71, #27AE60)' },
  'Almacén': { bg: '#3498DB', icon: '#FFFFFF', gradient: 'linear-gradient(135deg, #3498DB, #2980B9)' },
  'Librería': { bg: '#9B59B6', icon: '#FFFFFF', gradient: 'linear-gradient(135deg, #9B59B6, #8E44AD)' },
  'Farmacia': { bg: '#16A085', icon: '#FFFFFF', gradient: 'linear-gradient(135deg, #16A085, #1ABC9C)' },
  'Kiosco': { bg: '#E67E22', icon: '#FFFFFF', gradient: 'linear-gradient(135deg, #E67E22, #D35400)' },
  'Supermercado': { bg: '#2980B9', icon: '#FFFFFF', gradient: 'linear-gradient(135deg, #2980B9, #3498DB)' },
  'Fiambrería': { bg: '#F39C12', icon: '#FFFFFF', gradient: 'linear-gradient(135deg, #F39C12, #E67E22)' },
  'Panadería': { bg: '#D35400', icon: '#FFFFFF', gradient: 'linear-gradient(135deg, #D35400, #E67E22)' },
  'Restaurante': { bg: '#C0392B', icon: '#FFFFFF', gradient: 'linear-gradient(135deg, #C0392B, #E74C3C)' },
  'Comida': { bg: '#F39C12', icon: '#FFFFFF', gradient: 'linear-gradient(135deg, #F39C12, #E67E22)' },
  'Comidas': { bg: '#F39C12', icon: '#FFFFFF', gradient: 'linear-gradient(135deg, #F39C12, #E67E22)' },
  'Heladería': { bg: '#FF9FF3', icon: '#FFFFFF', gradient: 'linear-gradient(135deg, #FF9FF3, #F368E0)' },
  'Bebidas': { bg: '#54a0ff', icon: '#FFFFFF', gradient: 'linear-gradient(135deg, #54a0ff, #2e86de)' },
  'Ferretería': { bg: '#576574', icon: '#FFFFFF', gradient: 'linear-gradient(135deg, #576574, #222f3e)' },
  'Veterinaria': { bg: '#48dbfb', icon: '#FFFFFF', gradient: 'linear-gradient(135deg, #48dbfb, #0abde3)' },
  'Electrónica': { bg: '#341f97', icon: '#FFFFFF', gradient: 'linear-gradient(135deg, #341f97, #5f27cd)' },
  'Mascotas': { bg: '#ff9f43', icon: '#FFFFFF', gradient: 'linear-gradient(135deg, #ff9f43, #ee5253)' },
  'GoMarket': { bg: '#E11D48', icon: '#FFFFFF', gradient: 'linear-gradient(135deg, #E11D48, #FF4D6D)' },
};

// Phosphor Icons Mapping (Duotone style for premium look)
export const CATEGORY_PHOSPHOR_MAP = {
  'Todos': 'squares-four',
  'Carnicería': 'knife',
  'Pollería': 'bird',
  'Verdulería': 'leaf',
  'Almacén': 'storefront',
  'Librería': 'books',
  'Farmacia': 'pill',
  'Kiosco': 'cookie',
  'Supermercado': 'shopping-cart',
  'Fiambrería': 'cheese',
  'Panadería': 'bread',
  'Restaurante': 'hamburger',
  'Comida': 'hamburger',
  'Comidas': 'hamburger',
  'Heladería': 'ice-cream',
  'Bebidas': 'bottle',
  'Ferretería': 'wrench',
  'Veterinaria': 'first-aid-kit',
  'Electrónica': 'devices',
  'Mascotas': 'paw-print',
  'GoMarket': 'shopping-bag',
};


/**
 * Get category icon HTML (Using Phosphor Icons Library)
 */
export function categoryIcon(categoryName, size = 24, premium = true) {
  const iconName = CATEGORY_PHOSPHOR_MAP[categoryName] || 'package';
  const style = CATEGORY_STYLES[categoryName] || { bg: '#eee', icon: '#666' };

  // Phosphor Icon element
  const iconHtml = `<i class="ph-duotone ph-${iconName} category-icon-svg" style="font-size: ${size * 1.2}px; color: ${style.icon};"></i>`;

  if (premium) {
    return `
      <div class="category-icon-premium" style="background: ${style.gradient || style.bg}">
        ${iconHtml}
      </div>
    `;
  }

  return iconHtml;
}

/**
 * Get an SVG icon by name (Fallback/General UI)
 */
export function icon(name, size = 24, className = '', color = '') {
  let svg = ICONS[name];
  if (!svg) return '';
  const sizeAttr = typeof size === 'number' ? `${size}px` : size;
  const cls = className ? ` class="${className}"` : '';
  let result = svg.replace('width="1em"', `width="${sizeAttr}"`).replace('height="1em"', `height="${sizeAttr}"`).replace('<svg ', `<svg${cls} `);
  if (color) {
    result = result.replace(/stroke="currentColor"/g, `stroke="${color}"`).replace(/fill="currentColor"/g, `fill="${color}"`);
  }
  return result;
}






