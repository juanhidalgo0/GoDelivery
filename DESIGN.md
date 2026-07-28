# 🎨 GoDelivery Magdalena — Design System & Guidelines

Documento de referencia para el diseño, experiencia de usuario (UX) e interfaz visual (UI) de **GoDelivery Magdalena**. Este archivo actúa como guía de estilo para el desarrollo y optimización de componentes, evitando el "AI design slop" y manteniendo una estética premium, veloz y moderna.

---

## 🚀 1. Principios de Diseño

1. **Mobile-First & App Native Feel:** La aplicación está optimizada para smartphones (PWA / Capacitor). Las interacciones, gestos, barras de navegación y modales deben sentirse fluidos y táctiles.
2. **Claridad e Inmediatez:** El usuario busca pedir rápido. La jerarquía visual debe priorizar:
   - Estado del pedido (tracking).
   - Comercios destacados y categorías de rápida navegación.
   - Botones de acción principal (CTA) claros e inconfundibles.
3. **Estética Limpia y de Alto Contraste:** Se evitan sombras excesivas o borrosas, gradientes morados genéricos o combinaciones de baja legibilidad.
4. **Respeto al Tema (Modo Claro / Oscuro):** Todos los componentes deben adaptarse limpiamente a `data-theme="light"` y `data-theme="dark"`.

---

## 🎨 2. Paleta de Colores & Tokens CSS

### Colores Principales
- **Primary / Brand:** `#E11D48` *(Rose/Rojo vibrante de GoDelivery)*
- **Primary Hover / Active:** `#BE123C`
- **Secondary / Dark Accent:** `#1A1A1A`
- **Background Light:** `#FFFFFF` / `#F8FAFC`
- **Background Dark:** `#0F172A` / `#1E293B`

### Estados y Semántica
- **Éxito (Success):** `#10B981` *(Entregado, Aceptado, Disponible)*
- **Advertencia (Warning):** `#F59E0B` *(En preparación, Demora)*
- **Peligro / Cancelado (Danger):** `#EF4444` *(Cancelado, Error, Fuera de servicio)*
- **Info / Neutral:** `#3B82F6` / `#64748B`

---

## Typography & Jerarquía

- **Font Family Display:** `'Outfit', system-ui, -apple-system, sans-serif`
- **Font Family Body:** `'Inter', system-ui, -apple-system, sans-serif`

### Escala Tipográfica
- **Título de pantalla (H1):** `1.5rem (24px)`, `font-weight: 700`
- **Nombre de Comercio / Producto (H2):** `1.25rem (20px)`, `font-weight: 600`
- **Secciones / Subtítulos (H3):** `1rem (16px)`, `font-weight: 600`
- **Texto Principal (Body):** `0.875rem (14px)`, `font-weight: 400`
- **Metadatos / Etiquetas (Caption):** `0.75rem (12px)`, `font-weight: 500`

---

## 📦 3. Componentes y Patrones Visuales

### Tarjetas de Comercio / Producto
- **Bordes:** `border-radius: 16px` (tarjetas grandes) / `12px` (badges y botones).
- **Sombras:** Sutiles y nítidas `0 2px 8px rgba(0,0,0,0.06)` en light mode; bordes finos `#334155` en dark mode.
- **Badges:**
  - *"Envío Gratis"*: Fondo verde claro con texto verde oscuro.
  - *"Cerrado"*: Monocromático / Grayscale con opacidad reducida (`opacity: 0.6`).

### Botones (CTA)
- **Botón Primario:** Fondo `#E11D48`, texto blanco `#FFFFFF`, `padding: 12px 24px`, `border-radius: 12px`, sin borde.
- **Botón Secundario / Outline:** Fondo transparente, borde `1.5px solid var(--color-primary)`, texto `#E11D48`.
- **Efectos Táctiles:** `:active { transform: scale(0.98); opacity: 0.9; }` para respuesta táctil instantánea.

---

## 🚫 4. Anti-Patrones a Evitar (Design Slop)

❌ **NO utilizar:**
1. Gradientes morados-azules clichés sin relación con la marca `#E11D48`.
2. Sombras pesadas de color negro puro (`box-shadow: 0 10px 30px #000`).
3. Bordes demasiado redondeados tipo "píldora" en tarjetas cuadradas de contenido largo.
4. Falta de soporte para modo oscuro o colores hardcodeados fuera de variables CSS.
5. Textos grises sobre fondos grises con contraste inferior a 4.5:1.
