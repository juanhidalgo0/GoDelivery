# 🛵 GoDelivery Magdalena — Bot de WhatsApp 24/7 (100% Gratuito)

Servidor autónomo del bot de WhatsApp para **GoDelivery Magdalena** con **persistencia de sesión en Firebase Firestore**.

---

## 🌟 Características Principales

1. **⚡ Persistencia en Firestore:** Las credenciales y claves de la sesión se guardan automáticamente en tu base de datos de Firebase. **Escaneás el QR una sola vez** y podés reiniciar el servidor las veces que quieras sin perder la conexión.
2. **📱 Visor Web de Código QR:** Entrando a la URL pública de tu servidor (ej: `https://tu-bot.koyeb.app`), tenés un panel visual con el QR listo para escanear y el estado en vivo.
3. **🛎️ Respuestas Automáticas:**
   - Toma de **Mandados y GoFavores** interactivos con guardado en tiempo real en Firestore (`orders`).
   - Catálogo y redirección a Comercios de Magdalena.
   - Derivación inteligente a **Soporte Humano** (`support_chats`).
   - Consulta del estado de pedidos activos en tiempo real.
4. **💓 Healthcheck Anti-Sleep (`/health`):** Mantiene el servidor despierto 24/7 en plataformas gratuitas.

---

## 🚀 Guía de Despliegue 100% Gratuito en Koyeb (Recomendado - 5 Minutos)

[Koyeb](https://www.koyeb.com) ofrece un **plan gratuito permanente (Eco Instance)** con 512MB RAM que no se apaga.

### Paso 1: Crear una cuenta en Koyeb
1. Ingresá a [koyeb.com](https://www.koyeb.com) y registrate gratis (podés usar tu cuenta de GitHub o Google).

### Paso 2: Crear una nueva App
1. Hacé clic en **"Create App"**.
2. Elegí **GitHub** como método de despliegue y seleccioná el repositorio de GoDelivery (o subí la carpeta `whatsapp-bot` a un repo de GitHub).
3. En **Root Directory**, escribí: `whatsapp-bot` (o dejalo en `/` si creaste un repo dedicado para el bot).
4. En **Instance Type**, seleccioná **Eco Free (Nano o Micro)**.

### Paso 3: Configurar las Variables de Entorno (*Environment Variables*)
En la sección **Environment variables**, agregá:
* `FIREBASE_PROJECT_ID`: `godelivery-magdalena`
* `SESSION_NAME`: `godelivery_main_bot`
* `APP_URL`: `https://godelivery-magdalena.web.app`
* `FIREBASE_SERVICE_ACCOUNT_JSON`: Pegá todo el contenido del archivo `serviceAccountKey.json` de Firebase (todo el texto JSON).

### Paso 4: Escanear el Código QR
1. Una vez desplegado, Koyeb te dará una URL pública (ejemplo: `https://godelivery-bot-xxx.koyeb.app`).
2. Abrí esa URL en tu navegador: verás el panel de GoDelivery con el código QR.
3. Abrí WhatsApp en tu celular > **Dispositivos Vinculados** > **Vincular un dispositivo** y escaneá la pantalla.
4. ¡Listo! El estado cambiará a `🟢 CONECTADO` y el bot estará respondiendo mensajes las 24 horas del día.

---

## 🌐 Opción Alternativa: Despliegue en Render.com (Free Web Service)

1. Creá una cuenta en [render.com](https://render.com).
2. Hacé clic en **"New +"** > **"Web Service"**.
3. Conectá tu repositorio de GitHub.
4. En **Root Directory**, poné `whatsapp-bot`.
5. En **Build Command**: `npm install`.
6. En **Start Command**: `node index.js`.
7. En **Environment Variables**, agregá las mismas variables (`FIREBASE_SERVICE_ACCOUNT_JSON`, etc.).
8. Para evitar que Render duerma el servicio gratuito tras 15 min de inactividad:
   - Creá una cuenta gratis en [cron-job.org](https://cron-job.org) o [uptimerobot.com](https://uptimerobot.com).
   - Creá un monitor HTTP tipo GET a `https://tu-servicio-render.onrender.com/health` cada 10 minutos.

---

## 💻 Ejecución Local en tu PC (Para pruebas rápidas)

1. Abrí una terminal en la carpeta `whatsapp-bot`:
   ```bash
   cd whatsapp-bot
   npm install
   ```
2. Asegurate de tener tu archivo `serviceAccountKey.json` dentro de `whatsapp-bot/` o configurado en `.env`.
3. Ejecutá:
   ```bash
   npm start
   ```
4. Abrí `http://localhost:3000` en tu navegador y escaneá el QR.
